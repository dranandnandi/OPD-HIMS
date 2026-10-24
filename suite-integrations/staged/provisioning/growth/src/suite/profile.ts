import {supabase} from '../services/supabaseClient';
import {useStore} from '../store/useStore';
export function clearSuiteUser(){
 useStore.setState({user:null,appointments:[],reviews:[],creatives:[],categories:[],reportRequests:[],reviewRequestTemplates:[],sequenceMessages:[],sequenceTemplates:[],aiGeneratedTemplates:[],cache:{categories:null,sequenceTemplates:null,reviewRequestTemplates:null}});
}
export async function hydrateSuiteUser(){
 const {data,error}=await supabase.auth.getUser();if(error||!data.user)throw new Error('Sign in again.');
 const who=data.user.id;
 const profile=await supabase.from('users').select('*').eq('auth_id',who).single();
 if(profile.error||!profile.data)throw new Error('Your linked product profile is unavailable.');
 const current=await supabase.auth.getSession();if(current.data.session?.user.id!==who)throw new Error('Account changed during sign-in.');
 const userData=profile.data;
 const user = {
            id: userData.id,
            name: userData.name,
            role: userData.role,
            clinicName: userData.clinic_name,
            clinicAddress: userData.clinic_address,
            gmbLink: userData.gmb_link,
            logo: userData.logo,
            primaryColor: userData.primary_color,
            secondaryColor: userData.secondary_color,
            contactPhone: userData.contact_phone,
            contactEmail: userData.contact_email,
            contactWhatsapp: userData.contact_whatsapp,
            googleSheetId: userData.google_sheet_id,
            googleAppsScriptUrl: userData.google_apps_script_url,
            profileTypes: userData.profile_types || [],
            languages: userData.languages,
            defaultLanguage: userData.default_language,
            enabledFeatures: userData.enabled_features || [],
            clinicKeywords: userData.clinic_keywords || '[]',
            businessContext: userData.business_context || null
          };
 clearSuiteUser();useStore.getState().setUser(user);
}
