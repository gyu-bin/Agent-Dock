-- Phase 1: service-only, serverless-safe workspace lease with fencing.
create table if not exists public.workspace_leases (
  project_id text primary key,
  token uuid not null,
  expires_at timestamptz not null
);
alter table public.workspace_leases enable row level security;
revoke all on public.workspace_leases from public, anon, authenticated;
grant all on public.workspace_leases to service_role;
create or replace function public.workspace_acquire_lease(p_project_id text, p_token uuid, p_ttl_seconds integer default 120)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare acquired text;
begin
  insert into public.workspace_leases(project_id, token, expires_at)
  values(p_project_id, p_token, clock_timestamp() + make_interval(secs => least(greatest(p_ttl_seconds, 10), 120)))
  on conflict(project_id) do update set token = excluded.token, expires_at = excluded.expires_at
  where workspace_leases.expires_at <= clock_timestamp()
  returning project_id into acquired;
  return acquired is not null;
end;
$$;
create or replace function public.workspace_save_fenced(p_project_id text, p_token uuid, p_path text, p_content text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  perform 1 from public.workspace_leases where project_id = p_project_id and token = p_token and expires_at > clock_timestamp() for update;
  if not found then return false; end if;
  if p_path <> 'workspaces/' || p_project_id || '.json' then raise exception 'Invalid workspace document path'; end if;
  if p_content is null then delete from public.fs_files where path = p_path;
  else
    insert into public.fs_files(path, content, encoding, size, updated_at)
    values(p_path, p_content, 'utf8', octet_length(p_content), clock_timestamp())
    on conflict(path) do update set content = excluded.content, encoding = excluded.encoding, size = excluded.size, updated_at = excluded.updated_at;
  end if;
  return true;
end;
$$;
create or replace function public.workspace_release_lease(p_project_id text, p_token uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  delete from public.workspace_leases where project_id = p_project_id and token = p_token;
  return found;
end;
$$;
revoke all on function public.workspace_acquire_lease(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.workspace_save_fenced(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.workspace_release_lease(text, uuid) from public, anon, authenticated;
grant execute on function public.workspace_acquire_lease(text, uuid, integer) to service_role;
grant execute on function public.workspace_save_fenced(text, uuid, text, text) to service_role;
grant execute on function public.workspace_release_lease(text, uuid) to service_role;
