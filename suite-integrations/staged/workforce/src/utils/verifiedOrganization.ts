export type OrganizationProfile = { id: string; auth_id: string | null; organization_id: string | null; is_active: boolean | null };

export function requireVerifiedOrganization(profile: OrganizationProfile | null, authUserId: string): string {
  if (!authUserId || !profile || profile.auth_id !== authUserId || profile.is_active !== true || !profile.organization_id) {
    throw new Error('Your account has no active organisation membership. Ask your administrator to link or restore your account.');
  }
  return profile.organization_id;
}
