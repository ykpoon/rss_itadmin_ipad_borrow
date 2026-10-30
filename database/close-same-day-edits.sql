-- Tighten existing ordinary-user edit deadline. No row changes or policy changes.
begin;
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
commit;
