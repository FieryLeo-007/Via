-- WebAuthn state is server-only: browser users must never insert their own
-- unverified public key, alter signature counters, or mint approval challenges.
create table public.passkey_credentials (
    id text primary key check (length(id) between 1 and 2048),
    user_id uuid not null references auth.users(id) on delete cascade,
    public_key text not null,
    sign_count bigint not null default 0 check (sign_count >= 0),
    created_at timestamptz not null default now()
);
create index passkey_credentials_user_idx on public.passkey_credentials(user_id);

create table public.passkey_challenges (
    user_id uuid not null references auth.users(id) on delete cascade,
    purpose text not null check (purpose in ('registration', 'demo_approval')),
    id uuid not null unique,
    challenge text not null,
    expires_at timestamptz not null,
    order_id uuid,
    request_hash text,
    primary key (user_id, purpose),
    check ((purpose = 'registration' and order_id is null and request_hash is null)
        or (purpose = 'demo_approval' and order_id is not null and request_hash is not null))
);
-- At most two challenge rows per user; upserts replace expired/abandoned ones.
alter table public.passkey_credentials enable row level security;
alter table public.passkey_challenges enable row level security;
revoke all on public.passkey_credentials, public.passkey_challenges from public, anon, authenticated;
grant select, insert, update, delete on public.passkey_credentials, public.passkey_challenges to service_role;
comment on table public.passkey_credentials is 'Verified WebAuthn public keys only. No private keys or biometric data.';
comment on table public.passkey_challenges is 'Server-only, expiring challenges consumed atomically before verification.';
