-- Apply after the frontend uses the new cancellation RPC. No existing data is changed.
begin;
drop trigger if exists ipad_date_rules_write_guard on public.bookings;
create trigger ipad_date_rules_write_guard before insert or update or delete on public.bookings
for each row execute function ipad_date_rules.guard_booking_write();
commit;
