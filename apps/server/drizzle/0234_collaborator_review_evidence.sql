-- Freeze collaborator Hackatime evidence after a project enters review.
-- Journals and owner project evidence are already locked in these stages.
-- The parent FOR UPDATE lock serializes collaborator edits against shipping.
create or replace function guard_collaborator_review_evidence() returns trigger
language plpgsql as $$
declare
  parent_status text;
begin
  if new.hackatime_projects is not distinct from old.hackatime_projects
     and new.hackatime_seconds is not distinct from old.hackatime_seconds then
    return new;
  end if;

  select status into parent_status
    from projects where id = old.project_id for update;
  if parent_status in ('shipped', 'fraud_review', 'second_review') then
    raise exception 'collaborator Hackatime evidence is locked while project % is in review', old.project_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists project_collaborators_review_evidence_guard on project_collaborators;
create trigger project_collaborators_review_evidence_guard
  before update of hackatime_projects, hackatime_seconds on project_collaborators
  for each row execute function guard_collaborator_review_evidence();
