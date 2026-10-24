-- Central project only; manual invitation links. No emails are sent by this SQL.
BEGIN;
CREATE TABLE public.suite_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), member_id uuid NOT NULL REFERENCES public.suite_memberships(id),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '168 hours',
 created_by uuid NOT NULL, used_at timestamptz, used_by uuid REFERENCES auth.users(id), revoked_at timestamptz,
 CHECK(expires_at>created_at)
);
CREATE FUNCTION public.suite_issue_invitation(p_actor uuid,p_request uuid,p_org uuid,p_member uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_member suite_memberships; v_old suite_requests; v_input jsonb; v_result jsonb; v_invite suite_invitations;
BEGIN
 IF p_actor IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'Actor and request ID required'; END IF;
 v_input:=jsonb_build_object('organization_id',p_org,'member_id',p_member,'token_hash',p_hash);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 SELECT * INTO v_old FROM suite_requests WHERE id=p_request;
 IF FOUND THEN
  IF v_old.actor_id<>p_actor OR v_old.action<>'create_invitation' OR v_old.payload<>v_input THEN RAISE EXCEPTION 'Request ID already used for another operation'; END IF;
  RETURN v_old.result;
 END IF;
 PERFORM 1 FROM suite_organizations WHERE id=p_org FOR UPDATE;
 SELECT * INTO v_member FROM suite_memberships WHERE id=p_member AND organization_id=p_org FOR UPDATE;
 IF NOT FOUND OR v_member.status<>'pending' OR v_member.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'A pending unlinked member is required'; END IF;
 UPDATE suite_invitations SET revoked_at=now() WHERE member_id=p_member AND used_at IS NULL AND revoked_at IS NULL;
 INSERT INTO suite_invitations(member_id,token_hash,created_by) VALUES(p_member,p_hash,p_actor) RETURNING * INTO v_invite;
 v_result:=jsonb_build_object('organization_id',p_org,'invitation_id',v_invite.id,'expires_at',v_invite.expires_at);
 INSERT INTO suite_requests VALUES(p_request,p_actor,'create_invitation',v_input,v_result,now());
 INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(p_org,p_actor,'create_invitation',jsonb_build_object('member_id',p_member,'invitation_id',v_invite.id));
 RETURN v_result;
END $$;
CREATE FUNCTION public.suite_accept_invitation(p_user uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_invite suite_invitations; v_member suite_memberships; v_email text; v_org uuid;
BEGIN
 SELECT m.organization_id INTO v_org FROM suite_invitations i JOIN suite_memberships m ON m.id=i.member_id WHERE i.token_hash=p_hash;
 IF v_org IS NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 -- Same organisation-first lock order as membership changes and issue/reissue.
 PERFORM 1 FROM suite_organizations WHERE id=v_org FOR UPDATE;
 SELECT * INTO v_invite FROM suite_invitations WHERE token_hash=p_hash FOR UPDATE;
 SELECT * INTO v_member FROM suite_memberships WHERE id=v_invite.member_id FOR UPDATE;
 SELECT lower(trim(email)) INTO v_email FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL;
 IF v_email IS NULL OR v_email<>v_member.email OR v_member.status='disabled' OR v_invite.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 IF v_invite.used_at IS NOT NULL THEN
  IF v_invite.used_by=p_user AND v_member.auth_user_id=p_user AND v_member.status='active' THEN
   RETURN jsonb_build_object('organization_id',v_org,'member_id',v_member.id,'accepted',true);
  END IF;
  RAISE EXCEPTION 'Invitation already used';
 END IF;
 IF v_invite.expires_at<=now() OR v_member.status<>'pending' OR v_member.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'Invalid invitation'; END IF;
 UPDATE suite_memberships SET auth_user_id=p_user,status='active' WHERE id=v_member.id;
 UPDATE suite_invitations SET used_at=now(),used_by=p_user WHERE id=v_invite.id;
 PERFORM suite_queue_change(v_org);
 INSERT INTO suite_audit(organization_id,actor_id,action,details) VALUES(v_org,p_user,'accept_invitation',jsonb_build_object('member_id',v_member.id));
 RETURN jsonb_build_object('organization_id',v_org,'member_id',v_member.id,'accepted',true);
END $$;
ALTER TABLE public.suite_invitations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.suite_invitations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.suite_invitations TO service_role;
REVOKE ALL ON FUNCTION public.suite_issue_invitation(uuid,uuid,uuid,uuid,text),public.suite_accept_invitation(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.suite_issue_invitation(uuid,uuid,uuid,uuid,text),public.suite_accept_invitation(uuid,text) TO service_role;
COMMIT;
