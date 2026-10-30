-- Additive rules. Installs functions only; activate-booking-date-rules.sql attaches the guard.
-- Does not update/delete existing bookings or replace existing policies.
begin;
create schema if not exists ipad_date_rules;
revoke all on schema ipad_date_rules from public, anon;
grant usage on schema ipad_date_rules to authenticated;

create or replace function ipad_date_rules.school_today()
returns date language sql stable security invoker set search_path = '' as $$
  select (pg_catalog.statement_timestamp() at time zone 'Asia/Hong_Kong')::date
$$;
create or replace function ipad_date_rules.last_booking_date()
returns date language sql immutable security invoker set search_path = '' as $$
  select date '2026-12-31'
$$;
create or replace function ipad_date_rules.is_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.admins a
    where lower(btrim(a.email)) = lower(btrim(coalesce(auth.jwt()->>'email','')))
  )
$$;

create or replace function ipad_date_rules.guard_booking_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_admin boolean;
  v_email text;
begin
  -- Maintenance through the SQL editor/service role is separate from browser requests.
  if current_user not in ('anon','authenticated') then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if auth.uid() is null then raise exception '請先登入學校帳號。' using errcode='42501'; end if;
  -- Only the guarded, transactional cancellation RPC sets this local transaction context.
  if coalesce(pg_catalog.current_setting('ipad_date_rules.cancel_context',true),'')='cancel_v1' then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' then
    raise exception '取消流程已更新，請重新整理頁面後再取消；借用當日不可自行取消。' using errcode='42501';
  end if;
  v_admin := ipad_date_rules.is_admin();
  v_email := lower(btrim(coalesce(auth.jwt()->>'email','')));
  if tg_op='INSERT' then
    if new.date > ipad_date_rules.last_booking_date() then
      raise exception '2027 年 1 月或之後的借用暫未開放。' using errcode='23514';
    end if;
    if not v_admin and new.date < ipad_date_rules.school_today() then
      raise exception '不能新增過去日期的借用。' using errcode='23514';
    end if;
    if not v_admin and (lower(btrim(coalesce(new.user_email,'')))<>v_email or not exists(
      select 1 from public.teachers t where t.name=new.teacher_name and lower(btrim(coalesce(t.email,'')))=v_email
    )) then raise exception '借用老師身份不符。' using errcode='42501'; end if;
  else
    -- Existing 2027 records remain manageable, but cannot be moved/expanded into new bookings.
    if new.date > ipad_date_rules.last_booking_date() and
       (new.date is distinct from old.date or new.quantity > old.quantity) then
      raise exception '2027 年 1 月或之後的借用暫未開放，不能新增或增加數量。' using errcode='23514';
    end if;
    if not v_admin then
      if not exists(select 1 from public.teachers t where t.name=old.teacher_name and lower(btrim(coalesce(t.email,'')))=v_email) then
        raise exception '不能操作其他老師的借用記錄。' using errcode='42501';
      end if;
      if new.date is distinct from old.date or new.lesson is distinct from old.lesson
         or new.teacher_name is distinct from old.teacher_name or new.device_type is distinct from old.device_type
         or new.user_email is distinct from old.user_email or new.status is distinct from old.status then
        raise exception '此操作須由管理員處理。' using errcode='42501';
      end if;
      if old.date <= ipad_date_rules.school_today() then
        raise exception '已過修改及取消期限，請聯絡管理員。' using errcode='42501';
      end if;
    end if;
  end if;
  return new;
end
$$;

create or replace function public.ipad_cancel_booking_before_day_v1(p_booking_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_waiter public.bookings%rowtype;
  v_admin boolean;
  v_email text;
  v_capacity integer;
  v_used bigint;
  v_released integer;
  v_remaining integer;
  v_promoted integer := 0;
  v_previous_context text := coalesce(pg_catalog.current_setting('ipad_date_rules.cancel_context',true),'');
begin
  if auth.uid() is null then raise exception '請先登入學校帳號。' using errcode='42501'; end if;
  v_admin := ipad_date_rules.is_admin();
  v_email := lower(btrim(coalesce(auth.jwt()->>'email','')));
  perform pg_catalog.pg_advisory_xact_lock(80422026,3);
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then raise exception '預約不存在或已被取消。' using errcode='P0002'; end if;
  if not v_admin then
    if not exists(select 1 from public.teachers t where t.name=v_booking.teacher_name and lower(btrim(coalesce(t.email,'')))=v_email) then
      raise exception '不能取消其他老師的借用記錄。' using errcode='42501';
    end if;
    if v_booking.date <= ipad_date_rules.school_today() then
      raise exception '最遲須於借用日前一天取消；借用當日不可自行取消，請聯絡管理員。' using errcode='42501';
    end if;
    if v_booking.status not in ('pending','waiting') then
      raise exception '已取還的記錄請由管理員處理。' using errcode='42501';
    end if;
  end if;
  perform pg_catalog.set_config('ipad_date_rules.cancel_context','cancel_v1',true);
  delete from public.bookings where id=v_booking.id;
  if v_booking.status not in ('waiting','returned') then
    select coalesce(
      (select a.available_qty from public.daily_adjustments a where a.date=v_booking.date and a.device_type=v_booking.device_type),
      (select r.total_qty from public.resources r where r.name=v_booking.device_type),0
    ) into v_capacity;
    select coalesce(sum(b.quantity),0) into v_used from public.bookings b
      where b.date=v_booking.date and b.lesson=v_booking.lesson and b.device_type=v_booking.device_type and b.status not in ('waiting','returned');
    v_released := least(v_booking.quantity::bigint,greatest(0::bigint,v_capacity-v_used))::integer;
    for v_waiter in select * from public.bookings b
      where b.date=v_booking.date and b.lesson=v_booking.lesson and b.device_type=v_booking.device_type and b.status='waiting'
      order by b.created_at,b.id for update
    loop
      exit when v_released<=0;
      if v_waiter.quantity<=v_released then
        update public.bookings set status='pending',remarks='[候補成功] '||btrim(replace(coalesce(v_waiter.remarks,''),'[候補]','')) where id=v_waiter.id;
        v_released := v_released-v_waiter.quantity;
      else
        v_remaining := v_waiter.quantity-v_released;
        update public.bookings set quantity=v_released,status='pending',remarks='[候補成功] '||btrim(replace(coalesce(v_waiter.remarks,''),'[候補]','')) where id=v_waiter.id;
        -- Split an existing reservation, preserving its original demand and queue position.
        insert into public.bookings(date,lesson,slot,teacher_name,device_type,quantity,room,subject,class,status,remarks,user_email,usage_type,created_at)
        values(v_waiter.date,v_waiter.lesson,v_waiter.slot,v_waiter.teacher_name,v_waiter.device_type,v_remaining,v_waiter.room,v_waiter.subject,v_waiter.class,
          'waiting','[候補] '||btrim(replace(coalesce(v_waiter.remarks,''),'[候補]','')),v_waiter.user_email,coalesce(v_waiter.usage_type,'interactive'),v_waiter.created_at);
        v_released := 0;
      end if;
      v_promoted := v_promoted+1;
    end loop;
  end if;
  perform pg_catalog.set_config('ipad_date_rules.cancel_context',v_previous_context,true);
  return jsonb_build_object('cancelled_id',v_booking.id,'promoted_count',v_promoted);
exception when others then
  perform pg_catalog.set_config('ipad_date_rules.cancel_context',v_previous_context,true);
  raise;
end
$$;
revoke all on all functions in schema ipad_date_rules from public, anon;
grant execute on function ipad_date_rules.school_today(),ipad_date_rules.last_booking_date(),ipad_date_rules.is_admin() to authenticated;
revoke all on function public.ipad_cancel_booking_before_day_v1(uuid) from public, anon;
grant execute on function public.ipad_cancel_booking_before_day_v1(uuid) to authenticated;
commit;
