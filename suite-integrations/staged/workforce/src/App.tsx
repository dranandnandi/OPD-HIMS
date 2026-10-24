import { requireVerifiedOrganization } from './utils/verifiedOrganization';
import { useState, useEffect, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { supabase, retryOperation } from './utils/supabaseClient';
import LoginForm from './components/auth/LoginForm';
import ResetPasswordForm from './components/auth/ResetPasswordForm';
import Sidebar from './components/Sidebar';
import DashboardContainer from './components/DashboardContainer';
import Header from './components/Header';
import { lazy, Suspense } from 'react';
import ConversationDashboard from './components/ConversationDashboard';
import BottomNavigation from './components/BottomNavigation';
import { useMobileApp } from './hooks/useMobileApp';
import NotificationModal from './components/NotificationModal';


const Settings = lazy(() => import('./components/Settings'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const Reports = lazy(() => import('./components/Reports'));
const TaskModal = lazy(() => import('./components/TaskModal'));
const DeleteTasks = lazy(() => import('./components/DeleteTasks'));
const RecurringTasksManager = lazy(() => import('./components/RecurringTasksManager'));
const PerformanceReports = lazy(() => import('./components/PerformanceReports'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const LeaveManagement = lazy(() => import('./components/LeaveManagement'));
const PunchInOut = lazy(() => import('./components/hr/PunchInOut'));
const AttendanceDashboard = lazy(() => import('./components/hr/AttendanceDashboard'));
const AIAttendanceConfigurator = lazy(() => import('./components/hr/AIAttendanceConfigurator'));
const AIAttendanceReviewQueue = lazy(() => import('./components/hr/AIAttendanceReviewQueue'));
const AIAttendanceCenter = lazy(() => import('./components/hr/AIAttendanceCenter'));
const WhatsAppConnection = lazy(() => import('./components/WhatsAppConnection'));

// Payroll system lazy imports
const PayrollShell = lazy(() => import('./payroll/PayrollShell'));
const PayrollPreview = lazy(() => import('./payroll/PayrollPreview'));
const MyPayslip = lazy(() => import('./me/MyPayslip'));

import { Task, TaskType, User, OrganizationSettings, TaskStatus, TaskPriority } from './models/task';
import {
  DEFAULT_ADVISORY_TYPES,
  DEFAULT_FOLLOW_UP_TYPES,
  DEFAULT_ROUND_TYPES,
  withDefaultAdvisoryTypes,
  withDefaultFollowUpTypes,
  withDefaultRoundTypes,
} from './constants/taskOptions';
import { OrganizationProvider } from './contexts/OrganizationContext';

// Define interfaces for raw Supabase response data
interface RawSupabaseUser {
  id: string;
  name: string;
  whatsapp_number: string;
  role: string;
  department: string;
  is_active?: boolean;
}

interface RawSupabaseTask {
  id: string;
  type: TaskType;
  title: string;
  description: string;
  patient_id?: string;
  priority: string;
  status: string;
  created_at: string;
  updated_at: string;
  due_date?: string;
  completed_at?: string;
  location?: string;
  round_type?: string;
  follow_up_type?: string;
  advisory_type?: string;
  contact_number?: string;
  manual_whatsapp_number?: string;
  hours_to_complete?: number;
  organization_id: string;
  created_by?: string;
  assigned_to?: RawSupabaseUser[] | RawSupabaseUser | null;
}

interface RawSupabasePersonalTask {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
  user_id: string;
  assignee_id?: string;
  assignee?: RawSupabaseUser[] | RawSupabaseUser | null;
}

const getActiveJoinedUser = (
  user: RawSupabaseUser[] | RawSupabaseUser | null | undefined
): RawSupabaseUser | null => {
  const joinedUser = Array.isArray(user) ? user[0] : user;
  return joinedUser && joinedUser.is_active !== false ? joinedUser : null;
};

const toTaskUser = (user: RawSupabaseUser): User => ({
  id: user.id,
  name: user.name,
  whatsappNumber: user.whatsapp_number,
  role: user.role,
  department: user.department
});

function App() {
  const navigate = useNavigate();
  const [session, setSession] = useState<any>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState<TaskType | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [teamMembers, setTeamMembers] = useState<User[]>([]);
  const [personalTasks, setPersonalTasks] = useState<Task[]>([]);
  const [userRole, setUserRole] = useState<string>('');
  const [userOrganizationId, setUserOrganizationId] = useState<string | null>(null);
  const [isProfileEnsured, setIsProfileEnsured] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [hasInitialDataLoaded, setHasInitialDataLoaded] = useState(false);
  const isFetchingRef = useRef(false);

  // Initialize mobile app services (push notifications, etc.)
  useMobileApp();

  // Role-based access control component
  const ProtectedRoute: React.FC<{ children: React.ReactNode; allowedRoles: string[] }> = ({ children, allowedRoles }) => {
    if (!userRole || !allowedRoles.includes(userRole)) {
      return (
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You don't have permission to access this section.</p>
          </div>
        </div>
      );
    }
    return <>{children}</>;
  };

  // Add organization settings state with setter
  const [organizationSettings, setOrganizationSettings] = useState<OrganizationSettings>({
    id: '1',
    organizationId: '1',
    name: 'Staff Management Solution',
    advisoryTypes: [...DEFAULT_ADVISORY_TYPES],
    roundTypes: [...DEFAULT_ROUND_TYPES],
    followUpTypes: [...DEFAULT_FOLLOW_UP_TYPES],
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Global refresh function to refresh all data
  const handleGlobalRefresh = async () => {
    if (session && userOrganizationId) {
      if (isFetchingRef.current) {
        console.log('Skipping refresh - fetch already in progress');
        return;
      }

      isFetchingRef.current = true;
      setLoading(true);
      await Promise.all([
        fetchTasks(),
        fetchPersonalTasks(),
        fetchTeamMembers(),
        fetchOrganizationSettings()
      ]);
      setLoading(false);
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    // Check active sessions and subscribe to auth changes
    const setupAuth = async () => {
      console.log('Setting up auth...');
      const { data: { session: initialSession } } = await supabase.auth.getSession();
      console.log('Initial auth session:', initialSession ? 'Logged in' : 'Not logged in');
      setSession(initialSession);
      setLoading(false);
    };

    setupAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        setPasswordRecovery(true);
      }
      setSession(session);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let active = true;
    setUserOrganizationId(null); setUserRole(''); setIsProfileEnsured(false);
    setHasInitialDataLoaded(false); setProfileError(null);
    setTasks([]); setPersonalTasks([]); setTeamMembers([]);
    if (!session?.user?.id) return () => { active = false; };
    setLoading(true);
    void ensureUserProfile().then(organizationId => {
      if (!active) return;
      setUserOrganizationId(organizationId);
      setOrganizationSettings(previous => ({ ...previous, id: organizationId, organizationId }));
    }).catch(error => {
      if (active) setProfileError(error instanceof Error ? error.message : 'Organisation access could not be verified.');
    }).finally(() => {
      if (active) { setIsProfileEnsured(true); setLoading(false); }
    });
    return () => { active = false; };
  }, [session?.user?.id]);

  // New useEffect for initial data loading
  useEffect(() => {
    const loadInitialData = async () => {
      // Only proceed if we have a session, organization ID, profile is ensured, and data hasn't been loaded yet
      if (!session || !userOrganizationId || !isProfileEnsured || hasInitialDataLoaded || isFetchingRef.current) {
        return;
      }

      console.log('Loading initial application data...');
      isFetchingRef.current = true;
      setLoading(true);

      try {
        await Promise.all([
          fetchTasks(),
          fetchPersonalTasks(),
          fetchTeamMembers(),
          fetchOrganizationSettings()
        ]);

        console.log('Initial data load complete');
        setHasInitialDataLoaded(true);
      } catch (error) {
        console.error('Error loading initial data:', error);
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    };

    loadInitialData();
  }, [session, userOrganizationId, isProfileEnsured, hasInitialDataLoaded]);

  // Initialize default notification preferences for new users
  const initializeDefaultNotificationPreferences = async (userId: string) => {
    try {
      // Define default notification preferences
      const defaultPreferences = [
        { type: 'task_assigned', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_updated', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_completed', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_comment', enabled: true, advance_notice: '0 minutes' },
        { type: 'task_due', enabled: true, advance_notice: '1 day' } // This will handle multiple notifications
      ];

      // Check which preferences already exist
      const { data: existingPrefs, error: checkError } = await supabase
        .from('notification_preferences')
        .select('type')
        .eq('user_id', userId);

      if (checkError) {
        console.error('Error checking existing preferences:', checkError);
        return;
      }

      const existingTypes = new Set(existingPrefs?.map(p => p.type) || []);

      // Insert missing default preferences
      const missingPreferences = defaultPreferences.filter(pref => !existingTypes.has(pref.type));

      if (missingPreferences.length > 0) {
        const prefsToInsert = missingPreferences.map(pref => ({
          user_id: userId,
          type: pref.type,
          enabled: pref.enabled,
          advance_notice: pref.advance_notice
        }));

        const { error: insertError } = await supabase
          .from('notification_preferences')
          .insert(prefsToInsert);

        if (insertError) {
          console.error('Error inserting default notification preferences:', insertError);
        } else {
          console.log(`Initialized ${missingPreferences.length} default notification preferences for user`);
        }
      }
    } catch (error) {
      console.error('Error initializing default notification preferences:', error);
    }
  };

  // Fetch organization settings
  const fetchOrganizationSettings = async () => {
    try {
      if (!userOrganizationId) {
        console.warn('No organization ID available, skipping organization settings fetch');
        return;
      }

      console.log('Fetching organization settings...');
      if (!userOrganizationId) return;

      const { data, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('id', userOrganizationId)
        .single();

      if (error) throw error;
      if (!data) return;

      setOrganizationSettings({
        id: data.id,
        organizationId: data.id,
        name: data.name || 'Staff Management Solution',
        advisoryTypes: withDefaultAdvisoryTypes(data.advisory_types),
        roundTypes: withDefaultRoundTypes(data.round_types),
        followUpTypes: withDefaultFollowUpTypes(data.follow_up_types),
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      });
    } catch (error) {
      console.error('Error fetching organization settings:', error);
    }
  };

  // Organisation membership is provisioned by an administrator, never guessed.
  const ensureUserProfile = async (): Promise<string> => {
    if (!session?.user?.id) throw new Error('Sign in to continue.');
    const { data, error } = await supabase.from('users')
      .select('id, auth_id, organization_id, is_active').eq('auth_id', session.user.id).maybeSingle();
    if (error) throw new Error('Your organisation membership could not be checked. Please retry.');
    const organizationId = requireVerifiedOrganization(data, session.user.id);
    await initializeDefaultNotificationPreferences(data!.id);
    return organizationId;
  };

  const fetchPersonalTasks = async () => {
    try {
      console.log('Fetching personal tasks...');
      // Check if session and user ID are available
      if (!session?.user?.id || !userOrganizationId) {
        console.warn('No authenticated user session available');
        return;
      }

      await retryOperation(async () => {
        // Get current user's ID
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', session?.user?.id)
          .single();

        if (!userData) throw new Error('User not found');

        console.log('Fetching personal tasks for user ID:', userData.id);

        // Fetch personal tasks where user is either creator or assignee
        const { data: tasksData, error } = await supabase
          .from('personal_tasks')
          .select(`
            *,
            assignee:users!personal_tasks_assignee_id_fkey (
              id,
              name,
              whatsapp_number,
              role,
              department,
              is_active
            )
          `)
          .or(`user_id.eq.${userData.id},assignee_id.eq.${userData.id}`);

        console.log('Raw personal tasks data from Supabase:', tasksData);

        if (error) throw error;

        console.log('Processing personal tasks data, focusing on assignee field:');
        const typedPersonalTasksData = tasksData as RawSupabasePersonalTask[];
        typedPersonalTasksData.forEach((task, index) => {
          console.log(`Personal task ${index} (${task.id}) assignee:`, task.assignee);
        });

        const formattedTasks: Task[] = typedPersonalTasksData
          .filter(task => !task.assignee_id || getActiveJoinedUser(task.assignee))
          .map(task => {
            const assignee = getActiveJoinedUser(task.assignee);
            return {
              id: task.id,
              title: task.title,
              description: task.description,
              type: TaskType.PersonalTask,
              status: task.status as TaskStatus,
              priority: task.priority as TaskPriority,
              dueDate: task.due_date ? new Date(task.due_date) : undefined,
              createdAt: new Date(task.created_at),
              assignees: assignee ? [toTaskUser(assignee)] : []
            };
          });

        console.log('Formatted personal tasks with assignees:', formattedTasks);
        console.log('Personal tasks with empty assignees:', formattedTasks.filter(t => !t.assignees || t.assignees.length === 0).length);
        console.log('Personal tasks with assignees:', formattedTasks.filter(t => t.assignees && t.assignees.length > 0).length);

        setPersonalTasks(formattedTasks);
      });
    } catch (error) {
      console.error('Error fetching personal tasks:', error);
      alert('Failed to load personal tasks. Please check your connection and try again.');
    }
  };

  const fetchTeamMembers = async () => {
    try {
      console.log('Fetching team members...');
      // Check if session and user ID are available
      if (!session?.user?.id || !userOrganizationId) {
        console.warn('No authenticated user session available');
        return;
      }

      await retryOperation(async () => {
        // Use the stored organization ID if available, otherwise fetch from database
        let organizationId = userOrganizationId;
        let userRole = '';

        if (!organizationId) {
          // First get the user's organization ID
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('organization_id, role')
            .eq('auth_id', session?.user?.id)
            .single();

          if (userError) throw userError;
          if (!userData?.organization_id) throw new Error('No organization found');

          organizationId = userData.organization_id;
          userRole = userData.role || '';
          setUserOrganizationId(organizationId);
        } else {
          // Get user role if we don't have it
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('role')
            .eq('auth_id', session?.user?.id)
            .single();

          if (userError) throw userError;
          userRole = userData?.role || '';
        }

        // Set user role
        setUserRole(userRole);

        // Then fetch all active team members from that organization
        const { data: members, error: membersError } = await supabase
          .from('users')
          .select('id, name, whatsapp_number, role, department')
          .eq('organization_id', organizationId)
          .eq('is_active', true);

        if (membersError) throw membersError;

        // Transform the data to match our User interface
        const formattedMembers: User[] = members.map(member => ({
          id: member.id,
          name: member.name,
          whatsappNumber: member.whatsapp_number,
          role: member.role,
          department: member.department
        }));

        setTeamMembers(formattedMembers);
      });
    } catch (error: any) {
      console.error('Error fetching team members:', error);
      alert('Failed to load team members. Please check your connection and try again.');
    }
  };

  const fetchTasks = async () => {
    try {
      console.log('Fetching tasks...');
      // Check if session and user ID are available
      if (!session?.user?.id || !userOrganizationId) {
        console.warn('No authenticated user session available');
        return;
      }

      await retryOperation(async () => {
        // Use the stored organization ID if available, otherwise fetch from database
        let organizationId = userOrganizationId;

        if (!organizationId) {
          const { data: userData } = await supabase
            .from('users')
            .select('organization_id')
            .eq('auth_id', session?.user?.id)
            .single();

          if (!userData?.organization_id) {
            console.warn('User organization not found');
            return;
          }
          organizationId = userData.organization_id;
          setUserOrganizationId(organizationId);
        }

        console.log('Fetching tasks for organization ID:', organizationId);

        const { data: tasksData, error } = await supabase
          .from('tasks')
          .select(`
            id,
            type,
            title,
            description,
            patient_id,
            priority,
            status,
            created_at,
            updated_at,
            due_date,
            completed_at,
            location,
            round_type,
            follow_up_type,
            advisory_type,
            contact_number,
            manual_whatsapp_number,
            hours_to_complete,
            organization_id,
            created_by,
            assigned_to:users!tasks_assigned_to_fkey (
              id,
              name,
              whatsapp_number,
              role,
              department,
              is_active
            )
          `)
          .eq('organization_id', organizationId);

        console.log('Raw tasks data from Supabase:', tasksData);

        if (error) {
          console.error('Error fetching tasks from database:', error);
          // If it's a network error, don't throw - just log and return
          if (error.message?.includes('Failed to fetch') || error.message?.includes('fetch')) {
            console.warn('Network error fetching tasks, skipping update');
            return;
          }
          throw error;
        }

        // Ensure tasksData is an array before processing
        const typedTasksData = tasksData as RawSupabaseTask[];
        if (!Array.isArray(typedTasksData)) {
          console.warn('Tasks data is not an array:', tasksData);
          return;
        }

        console.log('Processing tasks data, focusing on assigned_to field:');
        tasksData.forEach((task, index) => {
          console.log(`Task ${index} (${task.id}) assigned_to:`, task.assigned_to);
        });

        const formattedTasks: Task[] = typedTasksData
          .filter(task => !task.assigned_to || getActiveJoinedUser(task.assigned_to))
          .map(task => {
            const assignee = getActiveJoinedUser(task.assigned_to);
            return {
              id: task.id,
              title: task.title,
              description: task.description,
              type: task.type,
              status: task.status as TaskStatus,
              priority: task.priority as TaskPriority,
              manualWhatsappNumber: task.manual_whatsapp_number,
              contactNumber: task.contact_number,
              assignees: assignee ? [toTaskUser(assignee)] : [],
              patientId: task.patient_id,
              dueDate: task.due_date ? new Date(task.due_date) : undefined,
              location: task.location,
              roundType: task.round_type,
              followUpType: task.follow_up_type,
              advisoryType: task.advisory_type,
              hoursToComplete: task.hours_to_complete,
              createdAt: new Date(task.created_at)
            };
          });

        console.log('Formatted tasks with assignees:', formattedTasks);
        console.log('Tasks with empty assignees:', formattedTasks.filter(t => !t.assignees || t.assignees.length === 0).length);
        console.log('Tasks with assignees:', formattedTasks.filter(t => t.assignees && t.assignees.length > 0).length);

        setTasks(formattedTasks);
      });
    } catch (error) {
      console.error('Error fetching tasks:', error);
      // Only show alert for non-network errors
      if (error instanceof Error && !error.message?.includes('Failed to fetch')) {
        alert('Failed to load tasks. Please check your connection and try again.');
      }
    }
  };

  // Handle adding new tasks or updating existing tasks
  const handleAddTasks = async (newTasks: Task[]) => {
    try {
      if (isFetchingRef.current) {
        console.log('Skipping task add/update - fetch already in progress');
        return;
      }

      // Handle personal tasks separately
      const task = newTasks[0];
      if (task.type === TaskType.PersonalTask) {
        const { data: userData } = await supabase
          .from('users')
          .select('id')
          .eq('auth_id', session?.user?.id)
          .single();

        if (!userData) throw new Error('User not found');
        const personalTask = {
          user_id: userData.id,
          assignee_id: task.assignees?.[0]?.id,
          title: task.title,
          description: task.description,
          priority: task.priority,
          status: task.status,
          due_date: task.dueDate?.toISOString()
        };

        if (editingTask) {
          const { error: updateError } = await supabase
            .from('personal_tasks')
            .update(personalTask)
            .eq('id', editingTask.id);

          if (updateError) throw updateError;
        } else {
          const { error: insertError } = await supabase
            .from('personal_tasks')
            .insert([personalTask]);

          if (insertError) throw insertError;
        }

        await fetchPersonalTasks();
        setEditingTask(null);
        setShowTaskModal(false);
        setSelectedTaskType(null);
        return;
      }

      await retryOperation(async () => {
        // Use the stored organization ID if available, otherwise fetch from database
        let organizationId = userOrganizationId;
        let userId = '';

        if (!organizationId) {
          const { data: userData } = await supabase
            .from('users')
            .select('organization_id, id')
            .eq('auth_id', session?.user?.id)
            .single();

          if (!userData?.organization_id) throw new Error('User organization not found');
          organizationId = userData.organization_id;
          userId = userData.id;
          setUserOrganizationId(organizationId);
        } else {
          // Get user ID
          const { data: userData } = await supabase
            .from('users')
            .select('id')
            .eq('auth_id', session?.user?.id)
            .single();

          if (!userData) throw new Error('User not found');
          userId = userData.id;
        }

        const tasksToInsert = newTasks.map(task => ({
          organization_id: organizationId,
          type: task.type,
          title: task.title,
          description: task.description,
          patient_id: task.patientId,
          assigned_to: task.assignees?.[0]?.id,
          priority: task.priority,
          status: task.status,
          due_date: task.dueDate?.toISOString(),
          location: task.location,
          round_type: task.roundType,
          follow_up_type: task.followUpType,
          advisory_type: task.advisoryType,
          contact_number: task.contactNumber,
          manual_whatsapp_number: task.manualWhatsappNumber,
          hours_to_complete: task.hoursToComplete,
          created_by: userId, // Use database user ID instead of auth ID
        } as const));

        if (editingTask) {
          // Update task
          const { error: updateError } = await supabase
            .from('tasks')
            .update(tasksToInsert[0])
            .eq('id', editingTask.id);

          if (updateError) throw updateError;

          // Log the update activity
          const { error: logError } = await supabase
            .from('task_activity_logs')
            .insert([{
              task_id: editingTask.id,
              user_id: userId,
              action_type: 'update',
              action_details: {
                previous: editingTask,
                updated: tasksToInsert[0],
                changes: Object.keys(tasksToInsert[0]).reduce((acc: Record<string, { from: any; to: any }>, key) => {
                  if (tasksToInsert[0][key as keyof typeof tasksToInsert[0]] !== (editingTask as any)[key]) {
                    acc[key] = {
                      from: (editingTask as any)[key],
                      to: tasksToInsert[0][key as keyof typeof tasksToInsert[0]]
                    };
                  }
                  return acc;
                }, {})
              }
            }]);

          if (logError) throw logError;
        } else {
          // Insert new task
          const { error: insertError } = await supabase
            .from('tasks')
            .insert(tasksToInsert);

          if (insertError) throw insertError;

          // Log the creation activity for each task
          // Since we can't get the inserted task IDs easily without select(), 
          // we'll skip activity logging for new tasks for now
          // The fetchTasks() call below will refresh the UI with the new data
          /*
          const activityLogs = tasksToInsert.map(task => ({
              task_id: 'unknown', // We don't have the ID without select()
              user_id: userId,
              action_type: 'create',
              action_details: {
                task: task
              }
            }));

            const { error: logError } = await supabase
              .from('task_activity_logs')
              .insert(activityLogs);

            if (logError) throw logError;
          */
        }

        // Refresh tasks list
        await fetchTasks();

        setEditingTask(null);
        setShowTaskModal(false);
        setSelectedTaskType(null);
      });
    } catch (error: any) {
      console.error('Error saving tasks:', error);
      alert(`Failed to save tasks: ${error.message || 'Unknown error'}`);
    }
  };

  // Handle editing a task
  const handleEditTask = (task: Task) => {
    setEditingTask(task);
    setShowTaskModal(true);
  };

  // Handle the "Add Task" button click
  const handleAddTaskClick = (type: TaskType) => {
    setSelectedTaskType(type);
    setShowTaskModal(true);
  };

  const handleRefreshTasks = async () => {
    try {
      await Promise.all([
        fetchTasks(),
        fetchPersonalTasks()
      ]);
    } catch (error) {
      console.error('Error refreshing tasks:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-md text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-gray-700 font-medium">Loading application...</p>
          {profileError && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md mt-4">
              {profileError}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Navigation handler for sidebar
  const handleNavigation = (view: string) => {
    navigate(`/${view === 'dashboard' ? '' : view}`);
  };

  if (!session) {
    return <LoginForm />;
  }

  if (passwordRecovery) {
    return <ResetPasswordForm onComplete={() => setPasswordRecovery(false)} />;
  }

  if (!isProfileEnsured || !userOrganizationId || profileError) {
    return <div className="min-h-screen flex items-center justify-center p-6"><div className="bg-white p-6 rounded shadow max-w-lg">
      <h1 className="text-xl font-semibold">Organisation access required</h1>
      <p className="my-4">{profileError || 'Checking your organisation membership?'}</p>
      <button className="underline mr-4" onClick={() => window.location.reload()}>Retry</button>
      <button className="underline" onClick={() => void supabase.auth.signOut()}>Sign out</button>
    </div></div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 safe-area-container">
      {/* Sidebar for larger screens */}
      <div className="hidden lg:block lg:w-64 lg:fixed lg:inset-y-0 lg:left-0 lg:z-30">
        <Sidebar
          isOpen={true}
          onClose={() => { }}
          onNavigate={handleNavigation}
          userRole={userRole}
          organizationSettings={organizationSettings}
        />
      </div>

      {/* Sidebar for smaller screens (mobile) */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setSidebarOpen(false)} />
          <Sidebar
            isOpen={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onNavigate={(view) => {
              handleNavigation(view);
              setSidebarOpen(false);
            }}
            userRole={userRole}
            organizationSettings={organizationSettings}
          />
        </div>
      )}

      {/* Main content area */}
      <div className="lg:ml-64 pb-16 lg:pb-0">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <Header onMenuClick={() => setSidebarOpen(true)} onRefresh={handleGlobalRefresh} organizationSettings={organizationSettings} />

          {/* Main content with Routes */}
          <main className="py-4 lg:py-6">
            <Routes>
              <Route path="/" element={
                <DashboardContainer
                  currentUserId={session?.user?.id}
                  tasks={tasks}
                  personalTasks={personalTasks}
                  onAddTask={handleAddTaskClick}
                  onEditTask={handleEditTask}
                  onTaskUpdate={handleRefreshTasks}
                  teamMembers={teamMembers}
                />
              } />
              <Route path="/settings" element={
                <Suspense fallback={<div className="p-4">Loading settings...</div>}>
                  <Settings />
                </Suspense>
              } />
              <Route path="/team" element={
                <Suspense fallback={<div className="p-4">Loading team management...</div>}>
                  <UserManagement />
                </Suspense>
              } />
              <Route path="/reports" element={
                <Suspense fallback={<div className="p-4">Loading reports...</div>}>
                  <Reports />
                </Suspense>
              } />
              <Route path="/deleteTasks" element={
                <Suspense fallback={<div className="p-4">Loading delete tasks...</div>}>
                  <DeleteTasks teamMembers={teamMembers} onTasksRefreshed={handleGlobalRefresh} />
                </Suspense>
              } />
              <Route path="/recurringTasks" element={
                <Suspense fallback={<div className="p-4">Loading recurring tasks...</div>}>
                  <RecurringTasksManager teamMembers={teamMembers} organizationSettings={organizationSettings} />
                </Suspense>
              } />
              <Route path="/performanceReports" element={
                <Suspense fallback={<div className="p-4">Loading performance reports...</div>}>
                  <PerformanceReports />
                </Suspense>
              } />
              <Route path="/conversations" element={
                <Suspense fallback={<div className="p-4">Loading conversation dashboard...</div>}>
                  <ConversationDashboard />
                </Suspense>
              } />
              <Route path="/whatsapp-connection" element={
                <Suspense fallback={<div className="p-4">Loading WhatsApp connection...</div>}>
                  <WhatsAppConnection />
                </Suspense>
              } />
              <Route path="/adminDashboard" element={
                <Suspense fallback={<div className="p-4">Loading admin dashboard...</div>}>
                  <AdminDashboard adminUserId={session?.user?.id || ''} />
                </Suspense>
              } />
              <Route path="/leaveManagement" element={
                <Suspense fallback={<div className="p-4">Loading leave management...</div>}>
                  <LeaveManagement userId={session?.user?.id} isAdmin={userRole === 'admin' || userRole === 'superadmin'} />
                </Suspense>
              } />
              <Route path="/attendance" element={
                <Suspense fallback={<div className="p-4">Loading attendance...</div>}>
                  <AttendanceDashboard />
                </Suspense>
              } />
              <Route path="/attendance/ai-center" element={
                <Suspense fallback={<div className="p-4">Loading AI center...</div>}>
                  {userOrganizationId ? (
                    <OrganizationProvider organizationId={userOrganizationId}>
                      <AIAttendanceCenter />
                    </OrganizationProvider>
                  ) : (
                    <div className="p-4">Loading organization...</div>
                  )}
                </Suspense>
              } />
              <Route path="/attendance/ai-configurator" element={
                <Suspense fallback={<div className="p-4">Loading AI configurator...</div>}>
                  {userOrganizationId ? (
                    <OrganizationProvider organizationId={userOrganizationId}>
                      <AIAttendanceConfigurator />
                    </OrganizationProvider>
                  ) : (
                    <div className="p-4">Loading organization...</div>
                  )}
                </Suspense>
              } />
              <Route path="/attendance/ai-review" element={
                <Suspense fallback={<div className="p-4">Loading AI review queue...</div>}>
                  {userOrganizationId ? (
                    <OrganizationProvider organizationId={userOrganizationId}>
                      <AIAttendanceReviewQueue />
                    </OrganizationProvider>
                  ) : (
                    <div className="p-4">Loading organization...</div>
                  )}
                </Suspense>
              } />
              <Route path="/punch" element={
                <Suspense fallback={<div className="p-4">Loading punch in/out...</div>}>
                  <PunchInOut />
                </Suspense>
              } />
              {/* Payroll System Routes */}
              <Route path="/payroll-preview" element={
                <Suspense fallback={<div className="p-4">Loading payroll preview...</div>}>
                  {userOrganizationId ? (
                    <OrganizationProvider organizationId={userOrganizationId}>
                      <PayrollPreview />
                    </OrganizationProvider>
                  ) : (
                    <div className="p-4">Loading organization...</div>
                  )}
                </Suspense>
              } />
              <Route path="/payroll/*" element={
                <ProtectedRoute allowedRoles={['admin', 'payroll_admin']}>
                  <Suspense fallback={<div className="p-4">Loading payroll...</div>}>
                    {userOrganizationId ? (
                      <OrganizationProvider organizationId={userOrganizationId}>
                        <PayrollShell />
                      </OrganizationProvider>
                    ) : (
                      <div className="p-4">Loading organization...</div>
                    )}
                  </Suspense>
                </ProtectedRoute>
              } />
              <Route path="/my-payslip" element={
                <ProtectedRoute allowedRoles={['admin', 'payroll_admin', 'user']}>
                  <Suspense fallback={<div className="p-4">Loading payslip...</div>}>
                    <MyPayslip />
                  </Suspense>
                </ProtectedRoute>
              } />
              {/* Catch-all route - redirect to dashboard */}
              <Route path="*" element={
                <DashboardContainer
                  currentUserId={session?.user?.id}
                  tasks={tasks}
                  personalTasks={personalTasks}
                  onAddTask={handleAddTaskClick}
                  onEditTask={handleEditTask}
                  onTaskUpdate={handleRefreshTasks}
                  teamMembers={teamMembers}
                />
              } />
            </Routes>
          </main>

        </div>

        {/* Bottom Navigation for Mobile */}
        <BottomNavigation onMenuClick={() => setSidebarOpen(true)} />

        {/* Task Modal */}
        <Suspense fallback={null}>
          {showTaskModal && (
            <TaskModal
              isOpen={showTaskModal}
              onClose={() => {
                setShowTaskModal(false);
                setSelectedTaskType(null);
                setEditingTask(null);
              }}
              onSubmit={handleAddTasks}
              initialTaskType={selectedTaskType}
              editingTask={editingTask}
              teamMembers={teamMembers}
              organizationSettings={organizationSettings}
            />
          )}
        </Suspense>

        {/* Notification Modal for push notifications with images */}
        <NotificationModal />
      </div>
    </div>
  );
}

export default App;
