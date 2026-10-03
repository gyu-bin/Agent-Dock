-- Service-only optimistic concurrency for the canonical project snapshot.
-- Expand-only: existing fs_files rows remain unchanged until a normal write.
create or replace function public.project_snapshot_compare_and_set(p_expected_revision bigint, p_content text)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  document jsonb;
  affected text;
begin
  document := p_content::jsonb;
  if p_expected_revision is null or p_expected_revision < 0
    or jsonb_typeof(document->'revision') is distinct from 'number'
    or (document->>'revision')::bigint <> p_expected_revision + 1
    or jsonb_typeof(document->'projects') is distinct from 'array'
    or jsonb_typeof(document->'tasks') is distinct from 'array' then
    raise exception 'Invalid project snapshot revision or structure';
  end if;
  update public.fs_files
  set content = p_content, encoding = 'utf8', size = octet_length(p_content), updated_at = clock_timestamp()
  where path = 'projects.json'
    and coalesce((content::jsonb->>'revision')::bigint, 0) = p_expected_revision
  returning path into affected;
  if affected is not null then return true; end if;
  if p_expected_revision <> 0 then return false; end if;
  insert into public.fs_files(path, content, encoding, size, updated_at)
  values('projects.json', p_content, 'utf8', octet_length(p_content), clock_timestamp())
  on conflict(path) do nothing
  returning path into affected;
  return affected is not null;
end;
$$;
revoke all on function public.project_snapshot_compare_and_set(bigint, text) from public, anon, authenticated;
grant execute on function public.project_snapshot_compare_and_set(bigint, text) to service_role;
