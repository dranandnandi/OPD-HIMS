# Clinic-Based User Management System - Architecture Documentation

## 📋 Overview

This document explains the **clinic-based user management system** in the OPD HIMS application, where:
- **Admin users** can create new users for their clinic
- Users are automatically scoped to their clinic (clinic-based isolation)
- Backend creates entries in both **`auth.users`** (Supabase Auth) and **`public.profiles`** (Application data)
- Role-based access control (RBAC) with permissions

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     User Management Flow                         │
└─────────────────────────────────────────────────────────────────┘

Admin UI (React)
    │
    ├── UserManagement.tsx (Frontend Component)
    │   └── Collects: email, password, name, role, clinic, etc.
    │
    ↓
authService.createUser() (Service Layer)
    │
    ├── 1. Calls Supabase Auth API
    │   └── supabase.auth.signUp({ email, password })
    │       └── Creates entry in auth.users table ✅
    │
    ├── 2. Calls authService.createProfile()
    │   └── INSERT into public.profiles table
    │       ├── Links to auth.users via user_id (FK)
    │       ├── Stores clinic_id (multi-tenancy)
    │       ├── Stores role_id & role_name (RBAC)
    │       └── Stores doctor-specific fields (if doctor) ✅
    │
    ↓
Database Tables Updated
    │
    ├── auth.users (Supabase Auth Schema)
    │   └── Stores: id, email, encrypted_password, email_confirmed_at
    │
    └── public.profiles (Application Schema)
        └── Stores: id, user_id, clinic_id, name, role_id, permissions, etc.
```

---

## 🔑 Key Components

### 1. **Frontend: UserManagement.tsx**

**Location:** `src/components/Settings/UserManagement.tsx`

**Purpose:** Admin interface for creating and managing users

**Key Features:**
- **Permission-gated:** Only users with `user_management` permission can access
- **Create/Edit/Delete** users
- **Role assignment** with automatic permission inheritance
- **Doctor-specific fields:** Specialization, qualification, consultation fees
- **Clinic scoping:** Automatically assigns current user's `clinic_id` to new users

**Code Snippet:**
```typescript
const handleSaveUser = async () => {
  if (selectedUser) {
    // Update existing user
    await authService.updateProfile(selectedUser.id, {...});
  } else {
    // Create new user
    await authService.createUser({
      ...formData,
      name: toTitleCase(formData.name),
      clinicId: user?.clinicId  // ← Automatic clinic scoping
    });
  }
}
```

---

### 2. **Backend: authService.createUser()**

**Location:** `src/services/authService.ts`

**Flow:**
```typescript
async createUser(userData) {
  // Step 1: Create auth user via Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: userData.email,
    password: userData.password,
    options: { emailRedirectTo: undefined }
  });

  // Step 2: Create profile in public.profiles table
  return this.createProfile(authData.user.id, {
    roleId: userData.roleId,
    clinicId: userData.clinicId,  // ← Multi-tenancy key
    name: userData.name,
    email: userData.email,
    // ... other fields
  });
}
```

**What Happens:**

1. **`supabase.auth.signUp()`** → Creates entry in **`auth.users`** table
   - Stores authentication credentials (email, hashed password)
   - Returns `user.id` (UUID)
   - Sends verification email (if enabled)

2. **`createProfile()`** → Creates entry in **`public.profiles`** table
   - Links to `auth.users` via `user_id` foreign key
   - Stores application-specific data (name, role, clinic, etc.)
   - Denormalizes role permissions for faster lookups

---

### 3. **Backend: authService.createProfile()**

**Location:** `src/services/authService.ts`

**Purpose:** Create application profile linked to auth user

**Code:**
```typescript
async createProfile(userId: string, profileData) {
  // 1. Fetch role details for denormalization
  const { data: roleData } = await supabase
    .from('roles')
    .select('name, permissions')
    .eq('id', profileData.roleId)
    .single();

  // 2. Prepare database record (camelCase → snake_case)
  const dbProfile = {
    id: userId,              // Same as auth.users.id
    user_id: userId,         // FK to auth.users
    role_id: profileData.roleId,
    clinic_id: profileData.clinicId,  // ← Multi-tenancy
    name: profileData.name,
    email: profileData.email,
    role_name: roleData.name,         // Denormalized
    permissions: roleData.permissions // Denormalized
    // ... other fields
  };

  // 3. Insert into profiles table
  const { data } = await supabase
    .from('profiles')
    .insert([dbProfile])
    .select(\`*, clinic_settings:clinic_id (*)\`);

  return convertDatabaseProfile(data[0]);
}
```

**Database Mapping:**
| Frontend (camelCase) | Database (snake_case) |
|----------------------|-----------------------|
| `userId` | `user_id` |
| `roleId` | `role_id` |
| `clinicId` | `clinic_id` |
| `roleName` | `role_name` |
| `registrationNo` | `registration_no` |
| `isOpenForConsultation` | `is_open_for_consultation` |

---

## 🗄️ Database Schema

### **auth.users** (Supabase Auth Schema)
```sql
CREATE TABLE auth.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  encrypted_password TEXT NOT NULL,
  email_confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
  -- ... other Supabase-managed fields
);
```

### **public.profiles** (Application Schema)
```sql
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinic_settings(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  
  -- User Information
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  
  -- Role Information (Denormalized for performance)
  role_name TEXT NOT NULL,
  permissions TEXT[] NOT NULL,
  
  -- Doctor-specific fields
  specialization TEXT,
  qualification TEXT,
  registration_no TEXT,
  consultation_fee DECIMAL(10, 2),
  follow_up_fee DECIMAL(10, 2),
  emergency_fee DECIMAL(10, 2),
  is_open_for_consultation BOOLEAN DEFAULT FALSE,
  
  -- Status
  is_active BOOLEAN DEFAULT TRUE,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_profiles_clinic_id ON public.profiles(clinic_id);
CREATE INDEX idx_profiles_role_id ON public.profiles(role_id);
CREATE INDEX idx_profiles_email ON public.profiles(email);
```

---

## 🔐 Multi-Tenancy (Clinic-Based Isolation)

### **How It Works:**

1. **Clinic Scoping:** Every user belongs to **one clinic** (`clinic_id`)
2. **RLS Policies:** Row-Level Security ensures users only see data from their clinic
3. **Automatic Assignment:** When admin creates a user, `clinic_id` is auto-assigned

**Example RLS Policy:**
```sql
CREATE POLICY "Users can only view profiles from their clinic"
ON public.profiles
FOR SELECT
USING (
  clinic_id IN (
    SELECT clinic_id 
    FROM public.profiles 
    WHERE id = auth.uid()
  )
);
```

**Effect:** 
- Clinic A's admin can only see/manage users from Clinic A
- Clinic B's admin can only see/manage users from Clinic B
- Data isolation at database level ✅

---

## 🎭 Role-Based Access Control (RBAC)

### **Roles Table:**
```sql
CREATE TABLE public.roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions TEXT[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### **Default Roles:**

| Role | Description | Permissions |
|------|-------------|-------------|
| **Admin** | Full clinic management | `user_management`, `settings`, `billing`, `reports`, `appointments` |
| **Doctor** | Medical consultations | `appointments`, `patients`, `prescriptions`, `visits` |
| **Receptionist** | Front desk operations | `appointments`, `patients`, `billing` |
| **Pharmacist** | Pharmacy management | `pharmacy`, `inventory`, `dispense` |
| **Lab Technician** | Lab operations | `laboratory`, `reports` |

### **Permission Check:**
```typescript
// In UI components
const { hasPermission } = useAuth();

if (!hasPermission('user_management')) {
  return <div>Access Denied</div>;
}
```

---

## 🔄 Complete User Creation Flow

### **Step-by-Step:**

```
1. Admin opens "User Management"
   └── UserManagement.tsx renders
   └── Checks permission: hasPermission('user_management')

2. Admin clicks "Add User"
   └── Modal opens with form

3. Admin fills form:
   ├── Name: "Dr. Rajesh Kumar"
   ├── Email: "rajesh@example.com"
   ├── Password: "SecurePass123"
   ├── Role: "Doctor"
   ├── Phone: "9876543210"
   ├── Specialization: "Cardiology"
   ├── Consultation Fee: "500"
   └── Is Open for Consultation: ✓

4. Admin clicks "Create User"
   └── handleSaveUser() triggered

5. Frontend Service Call:
   authService.createUser({
     email: "rajesh@example.com",
     password: "SecurePass123",
     name: "Dr. Rajesh Kumar",
     roleId: "uuid-doctor-role",
     clinicId: "uuid-clinic-a",  // Auto-assigned
     phone: "9876543210",
     specialization: "Cardiology",
     consultationFee: 500,
     isOpenForConsultation: true
   })

6. Backend Step 1: Create Auth User
   supabase.auth.signUp({
     email: "rajesh@example.com",
     password: "SecurePass123"
   })
   └── ✅ Entry created in auth.users
   └── Returns: { user: { id: "new-uuid-123" } }

7. Backend Step 2: Create Profile
   authService.createProfile("new-uuid-123", {
     roleId: "uuid-doctor-role",
     clinicId: "uuid-clinic-a",
     name: "Dr. Rajesh Kumar",
     email: "rajesh@example.com",
     ...
   })
   └── Fetches role permissions
   └── ✅ Entry created in public.profiles
   └── Returns: Profile object

8. UI Updates:
   └── Success message: "User created successfully!"
   └── User list refreshes
   └── Dr. Rajesh Kumar appears in list
```

---

## 🛡️ Security Features

### 1. **Permission-Based Access**
```typescript
// Only admins can create users
if (!hasPermission('user_management')) {
  return <AccessDenied />;
}
```

### 2. **Clinic Isolation**
```typescript
// Automatic clinic scoping
clinicId: user?.clinicId  // Current user's clinic only
```

### 3. **RLS Policies**
- Database-level enforcement
- Prevents cross-clinic data access
- Applies to all queries automatically

### 4. **Password Requirements**
- Minimum 6 characters (enforced by Supabase)
- Stored encrypted in `auth.users`
- Never returned to frontend

### 5. **Super Admin Protection**
```typescript
// Prevent regular admins from creating super admins
roles.filter(role => 
  !role.name.toLowerCase().includes('super_admin')
)
```

---

## 📊 Data Flow Diagram

```
┌─────────────────┐
│  Admin Browser  │
└────────┬────────┘
         │ 1. Submit form
         ↓
┌─────────────────────────────┐
│  UserManagement.tsx         │
│  - Validates input          │
│  - Formats data             │
│  - Adds clinicId            │
└────────┬────────────────────┘
         │ 2. createUser()
         ↓
┌─────────────────────────────┐
│  authService.ts             │
│  - createUser()             │
│  - createProfile()          │
└────┬────────────────┬───────┘
     │ 3a. signUp()   │ 3b. INSERT
     ↓                ↓
┌────────────┐  ┌──────────────┐
│ auth.users │  │   profiles   │
│  (Supabase │  │ (Application │
│    Auth)   │  │     Data)    │
└────────────┘  └──────────────┘
     │                │
     └────────┬───────┘
              │ 4. Return Profile
              ↓
     ┌─────────────────┐
     │  Admin Browser  │
     │  - Success msg  │
     │  - Refresh list │
     └─────────────────┘
```

---

## 🚀 Key Advantages

1. **✅ Automatic Sync:** `auth.users` and `profiles` stay in sync
2. **✅ Multi-Tenancy:** Clinic-based isolation at database level
3. **✅ RBAC:** Role-based permissions for fine-grained access control
4. **✅ Scalable:** Denormalized permissions for fast lookups
5. **✅ Secure:** RLS policies + permission checks + password encryption
6. **✅ Maintainable:** Clean separation of auth vs. application data

---

## 🔧 Maintenance Notes

### **Adding New Roles:**
1. Insert into `roles` table
2. Define permissions array
3. UI automatically picks up new roles

### **Adding New Permissions:**
1. Add to role's `permissions` array
2. Use `hasPermission('new_perm')` in UI
3. Add RLS policy if needed for database access

### **Updating User:**
```typescript
// Only updates profiles table (not auth.users)
await authService.updateProfile(userId, {
  name: "New Name",
  phone: "1234567890"
  // Can't update email/password here
});
```

### **Deleting User:**
```typescript
// Soft delete (sets is_active = false)
await authService.deleteUser(userId);

// Note: Does NOT delete from auth.users
// User can't login, but data is preserved
```

---

## 📝 Summary

**User Creation Process:**
1. **Admin UI** → Collects user data
2. **`authService.createUser()`** → Calls Supabase Auth
3. **`supabase.auth.signUp()`** → Creates `auth.users` entry
4. **`authService.createProfile()`** → Creates `profiles` entry
5. **Database** → Both tables updated, linked by `user_id`
6. **Result** → User can login and access their clinic's data

**Database Sync:**
- **`auth.users.id`** = **`profiles.user_id`** (Foreign Key)
- Cascade delete: If auth user is deleted, profile is also deleted
- One-to-one relationship maintained

**Multi-Tenancy:**
- Every user has `clinic_id`
- RLS policies enforce clinic-based isolation
- Admins can only manage users in their clinic

---

**Implementation Date:** January 2026  
**Status:** Production Ready 🚀  
**Architecture Pattern:** Multi-Tenant SaaS with RBAC
