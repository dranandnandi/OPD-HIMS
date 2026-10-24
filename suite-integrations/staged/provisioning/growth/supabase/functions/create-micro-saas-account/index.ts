import { withSuiteClient, guardEdge } from '../_shared/suite-runtime-guard.ts';
import { createClient as dsBase_createClient } from "npm:@supabase/supabase-js@2.45.4";
const createClient=withSuiteClient(dsBase_createClient);


type ProductSlug =
  | "review-booster"
  | "appointment-reminder"
  | "sequence-sender"
  | "smart-reports"
  | "marketing-creatives"
  | "gmb-manager"
  | "clinic-growth-suite";

interface CreateMicroSaasAccountPayload {
  productSlug?: ProductSlug;
  enabledFeatures?: string[];
  labName?: string;
  legalName?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  website?: string;
  gstin?: string;
  gmbLink?: string;
  adminName?: string;
  adminEmail?: string;
  adminPassword?: string;
  primaryColor?: string;
  secondaryColor?: string;
  reportSettings?: {
    defaultLanguage?: string;
    reportTypes?: string[];
    letterheadUrl?: string;
    doctorNameRequired?: boolean;
    allowHistoricalTrends?: boolean;
  };
  businessContext?: {
    businessType?: string;
    customerLabel?: string;
    appointmentLabel?: string;
    locationLabel?: string;
    serviceKeywords?: string;
    promptNotes?: string;
  };
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const productFeatures: Record<ProductSlug, string[]> = {
  "review-booster": ["dashboard", "reviews"],
  "appointment-reminder": ["dashboard", "appointments"],
  "sequence-sender": ["dashboard", "sequences"],
  "smart-reports": ["dashboard", "reports"],
  "marketing-creatives": ["dashboard", "creatives"],
  "gmb-manager": ["dashboard", "gmb"],
  "clinic-growth-suite": ["dashboard", "appointments", "reviews", "sequences", "reports", "creatives", "gmb"],
};

const passwordRule = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]).{8,}$/;
const emailRule = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders,
    },
  });
}

function makeRequestId() {
  return crypto.randomUUID().slice(0, 8);
}

function logInfo(requestId: string, step: string, data: Record<string, unknown> = {}) {
  console.log(`[create-micro-saas-account][${requestId}][${step}]`, JSON.stringify(data));
}

function logError(requestId: string, step: string, error: unknown, data: Record<string, unknown> = {}) {
  const safeError = error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : error;
  console.error(`[create-micro-saas-account][${requestId}][${step}]`, JSON.stringify({ error: safeError, ...data }));
}

function bad(requestId: string, message: string, status = 400, details?: Record<string, unknown>) {
  logError(requestId, "returning-error", message, { status, details });
  return json({ success: false, error: message, requestId, details }, status);
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  ) as Partial<T>;
}

function normalizePhone(value?: string) {
  return value ? value.replace(/\D/g, "").slice(0, 15) : null;
}

Deno.serve(guardEdge(async (req) => {
  const requestId = makeRequestId();

  if (req.method === "OPTIONS") {
    logInfo(requestId, "cors-preflight");
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  logInfo(requestId, "request-start", {
    method: req.method,
    url: req.url,
    userAgent: req.headers.get("user-agent"),
  });

  if (req.method !== "POST") return bad(requestId, "Use POST", 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return bad(requestId, "Missing Supabase service configuration", 500, {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasServiceRoleKey: Boolean(serviceRoleKey),
      });
    }

    let body: CreateMicroSaasAccountPayload;
    try {
      body = (await req.json()) as CreateMicroSaasAccountPayload;
    } catch (parseError) {
      logError(requestId, "parse-json", parseError);
      return bad(requestId, "Invalid JSON body", 400);
    }

    const productSlug = body.productSlug || "smart-reports";
    const enabledFeatures = Array.from(
      new Set(body.enabledFeatures?.length ? body.enabledFeatures : productFeatures[productSlug] || productFeatures["smart-reports"]),
    );

    const labName = body.labName?.trim();
    const adminName = body.adminName?.trim();
    const adminEmail = body.adminEmail?.trim().toLowerCase();
    const adminPassword = body.adminPassword || "";

    logInfo(requestId, "payload-summary", {
      productSlug,
      enabledFeatures,
      hasLabName: Boolean(labName),
      city: body.city || null,
      hasAdminName: Boolean(adminName),
      adminEmail,
      hasPhone: Boolean(body.phone),
      hasWhatsapp: Boolean(body.whatsapp),
      hasGmbLink: Boolean(body.gmbLink),
      reportTypes: body.reportSettings?.reportTypes || [],
      hasBusinessContext: Boolean(body.businessContext),
    });

    if (!labName) return bad(requestId, "Lab or business name is required");
    if (!adminName) return bad(requestId, "Admin name is required");
    if (!adminEmail || !emailRule.test(adminEmail)) return bad(requestId, "A valid admin email is required", 400, { adminEmail });
    if (!passwordRule.test(adminPassword)) {
      return bad(requestId, "Password must be at least 8 characters and include uppercase, lowercase, number, and special character");
    }

    logInfo(requestId, "supabase-client-init");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    logInfo(requestId, "checking-existing-user", { adminEmail });
    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from("users")
      .select("id")
      .eq("username", adminEmail)
      .maybeSingle();

    if (existingUserError) {
      logError(requestId, "checking-existing-user-failed", existingUserError, {
        code: existingUserError.code,
        details: existingUserError.details,
        hint: existingUserError.hint,
      });
      return bad(requestId, `Failed to check existing account: ${existingUserError.message}`, 400, {
        code: existingUserError.code,
        details: existingUserError.details,
        hint: existingUserError.hint,
      });
    }

    if (existingUser) return bad(requestId, "An account with this admin email already exists", 409, { adminEmail });

    logInfo(requestId, "checking-orphan-auth-user", { adminEmail });
    const { data: authUsers, error: listUsersError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (listUsersError) {
      logError(requestId, "checking-orphan-auth-user-failed", listUsersError, {
        status: listUsersError.status,
        code: listUsersError.code,
      });
    } else {
      const orphanAuthUser = authUsers.users.find((user) => user.email?.toLowerCase() === adminEmail);
      if (orphanAuthUser) {
        logInfo(requestId, "deleting-orphan-auth-user", { authId: orphanAuthUser.id, adminEmail });
        const { error: deleteOrphanError } = await supabaseAdmin.auth.admin.deleteUser(orphanAuthUser.id);
        if (deleteOrphanError) {
          logError(requestId, "deleting-orphan-auth-user-failed", deleteOrphanError, {
            authId: orphanAuthUser.id,
            status: deleteOrphanError.status,
            code: deleteOrphanError.code,
          });
          return bad(requestId, "An incomplete login already exists for this email and could not be cleaned up", 409, {
            adminEmail,
            authId: orphanAuthUser.id,
          });
        }
      }
    }

    logInfo(requestId, "creating-auth-user", { adminEmail, productSlug });
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
      user_metadata: {
        name: adminName,
        clinic_name: labName,
        product_slug: productSlug,
      },
    });

    if (authError) {
      logError(requestId, "creating-auth-user-failed", authError, {
        status: authError.status,
        code: authError.code,
      });
      return bad(requestId, `Failed to create login: ${authError.message}`, 400, {
        status: authError.status,
        code: authError.code,
      });
    }

    const authId = authData.user?.id;
    if (!authId) return bad(requestId, "Failed to create login user");
    logInfo(requestId, "auth-user-created", { authId });

    const clinicAddress = [body.address, body.city, body.state, body.pincode, body.country || "India"]
      .filter(Boolean)
      .join(", ");

    const businessContext = compactObject({
      businessType: body.businessContext?.businessType || (enabledFeatures.includes("reports") ? "Diagnostic lab" : "Clinic"),
      customerLabel: body.businessContext?.customerLabel || "patient",
      appointmentLabel: body.businessContext?.appointmentLabel || "visit",
      locationLabel: body.businessContext?.locationLabel || "center",
      serviceKeywords: body.businessContext?.serviceKeywords || "",
      promptNotes: [
        body.businessContext?.promptNotes,
        body.reportSettings ? `Smart report setup: ${JSON.stringify(body.reportSettings)}` : "",
        body.gstin ? `GSTIN: ${body.gstin}` : "",
        body.website ? `Website: ${body.website}` : "",
        body.legalName ? `Legal name: ${body.legalName}` : "",
      ].filter(Boolean).join("\n"),
    });

    const userInsertPayload = {
      auth_id: authId,
      username: adminEmail,
      password_hash: "supabase-auth",
      name: adminName,
      role: "admin",
      clinic_name: labName,
      clinic_address: clinicAddress || body.address || "Not provided",
      gmb_link: body.gmbLink || null,
      primary_color: body.primaryColor || "#4F46E5",
      secondary_color: body.secondaryColor || "#E5E7EB",
      contact_phone: normalizePhone(body.phone),
      contact_email: body.email || adminEmail,
      contact_whatsapp: normalizePhone(body.whatsapp || body.phone),
      enabled_features: enabledFeatures,
      clinic_keywords: body.businessContext?.serviceKeywords || "[]",
      business_context: businessContext,
      languages: {
        en: {
          name: labName,
          address: clinicAddress || body.address || "",
        },
      },
      default_language: body.reportSettings?.defaultLanguage || "en",
    };

    logInfo(requestId, "creating-public-user", {
      authId,
      username: adminEmail,
      clinicName: labName,
      enabledFeatures,
      columns: Object.keys(userInsertPayload),
    });

    const { data: createdUser, error: insertError } = await supabaseAdmin
      .from("users")
      .insert(userInsertPayload)
      .select("id, clinic_name, enabled_features")
      .single();

    if (insertError) {
      logError(requestId, "creating-public-user-failed", insertError, {
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
      });

      const { error: cleanupError } = await supabaseAdmin.auth.admin.deleteUser(authId);
      if (cleanupError) {
        logError(requestId, "cleanup-auth-user-failed", cleanupError, {
          authId,
          status: cleanupError.status,
          code: cleanupError.code,
        });
      } else {
        logInfo(requestId, "cleanup-auth-user-complete", { authId });
      }

      return bad(requestId, `Failed to create account profile: ${insertError.message}`, 400, {
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint,
      });
    }

    logInfo(requestId, "account-created", {
      userId: createdUser.id,
      clinicName: createdUser.clinic_name,
      enabledFeatures: createdUser.enabled_features,
    });

    return json({
      success: true,
      requestId,
      user: createdUser,
      authId,
      productSlug,
      enabledFeatures,
      message: "Account created successfully",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create account";
    logError(requestId, "unhandled-exception", error);
    return bad(requestId, message, 500);
  }
}, 'growth', 'create-micro-saas-account'));
