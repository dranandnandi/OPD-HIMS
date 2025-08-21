import { supabase } from '../lib/supabase';
import { 
  Supplier, 
  PharmacyInwardReceipt, 
  PharmacyInwardItem, 
  PharmacyDispensedItem, 
  StockMovementLog,
  MedicineMaster,
  MedicineWithPrice,
  StockAlert
} from '../types';
import { getCurrentProfile } from './profileService';
import type { 
  DatabaseSupplier, 
  DatabasePharmacyInwardReceipt, 
  DatabasePharmacyInwardItem, 
  DatabasePharmacyDispensedItem, 
  DatabaseStockMovementLog 
} from '../lib/supabase';

// Convert database supplier to app supplier type
const convertDatabaseSupplier = (dbSupplier: DatabaseSupplier): Supplier => ({
  id: dbSupplier.id,
  name: dbSupplier.name,
  contactPerson: dbSupplier.contact_person,
  phone: dbSupplier.phone,
  email: dbSupplier.email,
  address: dbSupplier.address,
  isActive: dbSupplier.is_active,
  createdAt: new Date(dbSupplier.created_at),
  updatedAt: new Date(dbSupplier.updated_at)
});

// Convert database inward receipt to app inward receipt type
const convertDatabaseInwardReceipt = (
  dbReceipt: DatabasePharmacyInwardReceipt, 
  supplier?: Supplier, 
  inwardItems?: PharmacyInwardItem[]
): PharmacyInwardReceipt => ({
  id: dbReceipt.id,
  supplierId: dbReceipt.supplier_id,
  invoiceNumber: dbReceipt.invoice_number,
  receiptDate: new Date(dbReceipt.receipt_date),
  totalAmount: dbReceipt.total_amount,
  uploadedBy: dbReceipt.uploaded_by,
  invoiceFileUrl: dbReceipt.invoice_file_url,
  status: dbReceipt.status,
  remarks: dbReceipt.remarks,
  createdAt: new Date(dbReceipt.created_at),
  updatedAt: new Date(dbReceipt.updated_at),
  supplier,
  inwardItems
});

// Convert database inward item to app inward item type
const convertDatabaseInwardItem = (dbItem: DatabasePharmacyInwardItem, medicine?: MedicineMaster): PharmacyInwardItem => ({
  id: dbItem.id,
  receiptId: dbItem.receipt_id,
  medicineId: dbItem.medicine_id,
  quantity: dbItem.quantity,
  unitCostPrice: dbItem.unit_cost_price,
  totalCostPrice: dbItem.total_cost_price,
  batchNumber: dbItem.batch_number,
  expiryDate: dbItem.expiry_date ? new Date(dbItem.expiry_date) : undefined,
  createdAt: new Date(dbItem.created_at),
  medicine
});

// Convert database dispensed item to app dispensed item type
const convertDatabaseDispensedItem = (dbItem: DatabasePharmacyDispensedItem, medicine?: MedicineMaster): PharmacyDispensedItem => ({
  id: dbItem.id,
  visitId: dbItem.visit_id,
  prescriptionId: dbItem.prescription_id,
  medicineId: dbItem.medicine_id,
  quantity: dbItem.quantity,
  dispensedBy: dbItem.dispensed_by,
  dispenseDate: new Date(dbItem.dispense_date),
  sellingPriceAtDispense: dbItem.selling_price_at_dispense,
  totalSellingPrice: dbItem.total_selling_price,
  batchNumber: dbItem.batch_number,
  createdAt: new Date(dbItem.created_at),
  medicine
});

// Convert database stock movement log to app stock movement log type
const convertDatabaseStockMovementLog = (dbLog: DatabaseStockMovementLog, medicine?: MedicineMaster): StockMovementLog => ({
  id: dbLog.id,
  medicineId: dbLog.medicine_id,
  movementType: dbLog.movement_type,
  quantityChange: dbLog.quantity_change,
  newStockLevel: dbLog.new_stock_level,
  referenceId: dbLog.reference_id,
  referenceType: dbLog.reference_type,
  movedBy: dbLog.moved_by,
  movementDate: new Date(dbLog.movement_date),
  remarks: dbLog.remarks,
  createdAt: new Date(dbLog.created_at),
  medicine
});

// Convert database stock alert to app stock alert type
const convertDatabaseStockAlert = (dbAlert: any, medicine?: MedicineMaster): StockAlert => ({
  id: dbAlert.id,
  medicineId: dbAlert.medicine_id,
  alertType: dbAlert.alert_type,
  message: dbAlert.message,
  createdAt: new Date(dbAlert.created_at),
  isResolved: dbAlert.is_resolved,
  resolvedAt: dbAlert.resolved_at ? new Date(dbAlert.resolved_at) : undefined,
  resolvedBy: dbAlert.resolved_by,
  medicine
});

export const pharmacyService = {
  // Supplier Management
  async getSuppliers(): Promise<Supplier[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      throw new Error('Failed to fetch suppliers');
    }

    return data.map(convertDatabaseSupplier);
  },

  async addSupplier(supplier: Omit<Supplier, 'id' | 'createdAt' | 'updatedAt'>): Promise<Supplier> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('suppliers')
      .insert([{
        name: supplier.name,
        clinic_id: profile.clinicId,

        contact_person: supplier.contactPerson,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        is_active: supplier.isActive
      }])
      .select()
      .single();

    if (error) {
      throw new Error('Failed to add supplier');
    }

    return convertDatabaseSupplier(data);
  },

  // Inward Receipt Management
  async getInwardReceipts(): Promise<PharmacyInwardReceipt[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('pharmacy_inward_receipts')
      .select(`
        *,
        clinic_id,
        suppliers (*),
        pharmacy_inward_items (*, medicines_master (*))
      `)
      .eq('clinic_id', profile.clinicId)
      .order('receipt_date', { ascending: false });

    if (error) {
      console.error('Error fetching inward receipts:', error);
      throw new Error('Failed to fetch inward receipts');
    }

    return data.map(receipt => convertDatabaseInwardReceipt(
      receipt,
      receipt.suppliers ? convertDatabaseSupplier(receipt.suppliers) : undefined,
      receipt.pharmacy_inward_items?.map(item => convertDatabaseInwardItem(item, item.medicines_master)) || []
    ));
  },

  async createInwardReceipt(
    receipt: Omit<PharmacyInwardReceipt, 'id' | 'createdAt' | 'updatedAt' | 'supplier' | 'inwardItems'>,
    items: Omit<PharmacyInwardItem, 'id' | 'receiptId' | 'createdAt' | 'medicine' | 'totalCostPrice'>[]
  ): Promise<PharmacyInwardReceipt> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Insert receipt
      const { data: receiptData, error: receiptError } = await supabase
        .from('pharmacy_inward_receipts')
        .insert([{
          clinic_id: profile.clinicId,
          supplier_id: receipt.supplierId,
          invoice_number: receipt.invoiceNumber,
          receipt_date: receipt.receiptDate.toISOString(),
          total_amount: receipt.totalAmount,
          uploaded_by: receipt.uploadedBy,
          invoice_file_url: receipt.invoiceFileUrl,
          status: receipt.status,
          remarks: receipt.remarks
        }])
        .select()
        .single();

      if (receiptError) {
        throw new Error('Failed to create inward receipt');
      }

      // Insert items
      if (items.length > 0) {
        const itemsToInsert = items.map(item => ({
          receipt_id: receiptData.id,
          clinic_id: profile.clinicId,
          medicine_id: item.medicineId,
          quantity: item.quantity,
          unit_cost_price: item.unitCostPrice,
          batch_number: item.batchNumber,
          expiry_date: item.expiryDate?.toISOString()
        }));

        const { error: itemsError } = await supabase
          .from('pharmacy_inward_items')
          .insert(itemsToInsert);

        if (itemsError) {
          throw new Error('Failed to create inward items');
        }
      }

      // Fetch the complete receipt with items
      const { data: completeReceipt, error: fetchError } = await supabase
        .from('pharmacy_inward_receipts')
        .select(`
          clinic_id,
          *,
          suppliers (*),
          pharmacy_inward_items (*, medicines_master (*))
        `)
        .eq('id', receiptData.id)
        .single();

      if (fetchError) {
        throw new Error('Failed to fetch created receipt');
      }

      return convertDatabaseInwardReceipt(
        completeReceipt,
        completeReceipt.suppliers ? convertDatabaseSupplier(completeReceipt.suppliers) : undefined,
        completeReceipt.pharmacy_inward_items?.map(item => convertDatabaseInwardItem(item, item.medicines_master)) || []
      );

    } catch (error) {
      console.error('Error creating inward receipt:', error);
      throw error;
    }
  },

  // Medicine Dispensing
  async dispenseMedicines(
    items: Omit<PharmacyDispensedItem, 'id' | 'createdAt' | 'medicine' | 'dispensedByProfile' | 'totalSellingPrice'>[]
  ): Promise<PharmacyDispensedItem[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const itemsToInsert = items.map(item => ({
        visit_id: item.visitId,
        prescription_id: item.prescriptionId,
        clinic_id: profile.clinicId,

        medicine_id: item.medicineId,
        quantity: item.quantity,
        dispensed_by: item.dispensedBy,
        dispense_date: item.dispenseDate.toISOString(),
        selling_price_at_dispense: item.sellingPriceAtDispense,
        batch_number: item.batchNumber
      }));

      const { data, error } = await supabase
        .from('pharmacy_dispensed_items')
        .insert(itemsToInsert)
        .select(`
          *,
          medicines_master (*),
          profiles (*)
        `);

      if (error) {
        throw new Error('Failed to dispense medicines');
      }

      return data.map(item => convertDatabaseDispensedItem(item, item.medicines_master));

    } catch (error) {
      console.error('Error dispensing medicines:', error);
      throw error;
    }
  },

  // Stock Management
  async getStockMovementLog(medicineId?: string): Promise<StockMovementLog[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('stock_movement_log')
      .select(`
        *,
        clinic_id,
        medicines_master (*),
        profiles (*)
      `)
      .order('movement_date', { ascending: false });

    if (medicineId) {
      query = query.eq('medicine_id', medicineId);
      query = query.eq('clinic_id', profile.clinicId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch stock movement log');
    }

    return data.map(log => convertDatabaseStockMovementLog(log, log.medicines_master));
  },

  async getLowStockMedicines(clinicId?: string): Promise<MedicineWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('medicines_master')
      .select(`
        *,
        clinic_medicine_prices!left (
          selling_price,
          cost_price
        )
      `)
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId)
      .gt('reorder_level', 0)
      .order('current_stock');

    if (error) {
      throw new Error('Failed to fetch low stock medicines');
    }

    // Filter medicines where current_stock <= reorder_level in JavaScript
    const lowStockMedicines = data.filter(medicine => 
      medicine.current_stock <= medicine.reorder_level
    );

    return lowStockMedicines.map(medicine => {
      const baseMedicine = {
        id: medicine.id,
        name: medicine.name,
        genericName: medicine.generic_name,
        brandName: medicine.brand_name,
        category: medicine.category,
        dosageForm: medicine.dosage_form,
        strength: medicine.strength,
        manufacturer: medicine.manufacturer,
        description: medicine.description,
        sideEffects: medicine.side_effects,
        contraindications: medicine.contraindications,
        currentStock: medicine.current_stock,
        reorderLevel: medicine.reorder_level,
        batchNumber: medicine.batch_number,
        expiryDate: medicine.expiry_date ? new Date(medicine.expiry_date) : undefined,
        isActive: medicine.is_active,
        createdAt: new Date(medicine.created_at),
        updatedAt: new Date(medicine.updated_at)
      };
      
      const priceData = medicine.clinic_medicine_prices?.[0];
      
      return {
        ...baseMedicine,
        sellingPrice: priceData?.selling_price,
        costPrice: priceData?.cost_price
      };
    });
  },

  async getExpiringMedicines(daysAhead: number = 30, clinicId?: string): Promise<MedicineWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const { data, error } = await supabase
      .from('medicines_master')
      .select(`
        *,
        clinic_medicine_prices!left (
          selling_price,
          cost_price
        )
      `)
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId)
      .not('expiry_date', 'is', null)
      .lte('expiry_date', futureDate.toISOString())
      .gt('current_stock', 0)
      .order('expiry_date');

    if (error) {
      throw new Error('Failed to fetch expiring medicines');
    }

    return data.map(medicine => {
      const baseMedicine = {
        id: medicine.id,
        name: medicine.name,
        genericName: medicine.generic_name,
        brandName: medicine.brand_name,
        category: medicine.category,
        dosageForm: medicine.dosage_form,
        strength: medicine.strength,
        manufacturer: medicine.manufacturer,
        description: medicine.description,
        sideEffects: medicine.side_effects,
        contraindications: medicine.contraindications,
        currentStock: medicine.current_stock,
        reorderLevel: medicine.reorder_level,
        batchNumber: medicine.batch_number,
        expiryDate: medicine.expiry_date ? new Date(medicine.expiry_date) : undefined,
        isActive: medicine.is_active,
        createdAt: new Date(medicine.created_at),
        updatedAt: new Date(medicine.updated_at)
      };
      
      const priceData = medicine.clinic_medicine_prices?.[0];
      
      return {
        ...baseMedicine,
        sellingPrice: priceData?.selling_price,
        costPrice: priceData?.cost_price
      };
    });
  },

  // Dashboard Analytics
  async getPharmacyDashboardData(clinicId?: string): Promise<{
    totalMedicines: number;
    lowStockCount: number;
    expiringCount: number;
    totalStockValue: number;
    recentMovements: StockMovementLog[];
  }> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const [
        allMedicines,
        
        lowStockMedicines,
        expiringMedicines,
        { data: recentMovements }
      ] = await Promise.all([
        this.getAllMedicinesWithPrices(clinicId),
        this.getLowStockMedicines(clinicId),
        this.getExpiringMedicines(30, clinicId),
        supabase
          .from('stock_movement_log')
          .select(`
            *,
            medicines_master (*),
            clinic_id,
            profiles (*)
          `)
          .order('movement_date', { ascending: false })
          .limit(10)
      ]);

      const totalStockValue = allMedicines.reduce((sum, medicine) => {
        return sum + (medicine.currentStock * (medicine.costPrice || 0));
      }, 0) || 0;

      return {
        totalMedicines: allMedicines.length,
        lowStockCount: lowStockMedicines.length,
        expiringCount: expiringMedicines.length,
        totalStockValue,
        recentMovements: recentMovements?.map(log => convertDatabaseStockMovementLog(log, log.medicines_master)) || []
      };

    } catch (error) {
      console.error('Error fetching pharmacy dashboard data:', error);
      throw new Error('Failed to fetch pharmacy dashboard data');
    }
  },

  async getAllMedicinesWithPrices(clinicId?: string): Promise<MedicineWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('medicines_master')
      .select(`
        *,
        clinic_medicine_prices!left (
          selling_price,
          cost_price
        )
      `)
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId);

    if (error) {
      throw new Error('Failed to fetch medicines with prices');
    }

    return data.map(medicine => {
      const baseMedicine = {
        id: medicine.id,
        name: medicine.name,
        genericName: medicine.generic_name,
        brandName: medicine.brand_name,
        category: medicine.category,
        dosageForm: medicine.dosage_form,
        strength: medicine.strength,
        manufacturer: medicine.manufacturer,
        description: medicine.description,
        sideEffects: medicine.side_effects,
        contraindications: medicine.contraindications,
        currentStock: medicine.current_stock,
        reorderLevel: medicine.reorder_level,
        batchNumber: medicine.batch_number,
        expiryDate: medicine.expiry_date ? new Date(medicine.expiry_date) : undefined,
        isActive: medicine.is_active,
        createdAt: new Date(medicine.created_at),
        updatedAt: new Date(medicine.updated_at)
      };
      
      const priceData = medicine.clinic_medicine_prices?.[0];
      
      return {
        ...baseMedicine,
        sellingPrice: priceData?.selling_price,
        costPrice: priceData?.cost_price
      };
    });
  },

  // Stock Alerts Management
  async getStockAlerts(includeResolved: boolean = false): Promise<StockAlert[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('stock_alerts')
      .select(`
        *,
        clinic_id,
        medicines_master!stock_alerts_medicine_id_fkey (*)
      `)
      .order('created_at', { ascending: false });

    if (!includeResolved) {
      query = query.eq('is_resolved', false);
    }
    query = query.eq('clinic_id', profile.clinicId);

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch stock alerts');
    }

    return data.map(alert => convertDatabaseStockAlert(alert, alert.medicines_master));
  },

  async resolveStockAlert(alertId: string, resolvedBy: string): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { error } = await supabase
      .from('stock_alerts')
      .update({
        is_resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_by: resolvedBy
      })
      .eq('clinic_id', profile.clinicId)
      .eq('id', alertId);

    if (error) {
      throw new Error('Failed to resolve stock alert');
    }
  },

  async triggerStockAlertsCheck(): Promise<{ success: boolean; message: string }> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) throw new Error('Not authenticated');
      const token = session.access_token;

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/predict-stock-alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`Stock alerts check failed: ${response.statusText}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Error triggering stock alerts check:', error);
      throw error;
    }
  },

  // Medicine Returns
  async returnMedicines(
    medicineId: string,
    quantity: number,
    reason: string,
    supplierId?: string,
    returnedBy?: string
  ): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Fetch current medicine stock
      const { data: medicine, error: medicineError } = await supabase
        .from('medicines_master')
        .select('id, name, current_stock')
        .eq('id', medicineId)
        .eq('clinic_id', profile.clinicId)
        .single();

      if (medicineError || !medicine) {
        throw new Error('Medicine not found or error fetching medicine data');
      }

      if (medicine.current_stock < quantity) {
        throw new Error(`Insufficient stock to return. Available: ${medicine.current_stock}, Requested: ${quantity}`);
      }

      const newStockLevel = medicine.current_stock - quantity;

      // Update medicine stock
      const { error: updateError } = await supabase
        .from('medicines_master')
        .update({ current_stock: newStockLevel })
        .eq('clinic_id', profile.clinicId)
        .eq('id', medicineId);

      if (updateError) {
        throw new Error(`Failed to update medicine stock: ${updateError.message}`);
      }

      // Create stock movement log entry
      const movementRemarks = `Return to supplier: ${reason}${supplierId ? ` (Supplier ID: ${supplierId})` : ''}`;
      
      const { error: logError } = await supabase
        .from('stock_movement_log')
        .insert([{
          clinic_id: profile.clinicId,
          medicine_id: medicineId,
          movement_type: 'return',
          quantity_change: -quantity,
          new_stock_level: newStockLevel,
          reference_type: 'return_to_supplier',
          reference_id: supplierId,
          moved_by: returnedBy,
          movement_date: new Date().toISOString(),
          remarks: movementRemarks
        }]);

      if (logError) {
        throw new Error(`Failed to log stock movement: ${logError.message}`);
      }

    } catch (error) {
      console.error('Error returning medicines:', error);
      throw error;
    }
  },

  // Stock Adjustments
  async adjustStock(
    medicineId: string,
    quantityChange: number,
    reason: string,
    adjustedBy: string
  ): Promise<void> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    try {
      // Fetch current medicine stock
      const { data: medicine, error: medicineError } = await supabase
        .from('medicines_master')
        .select('id, name, current_stock')
        .eq('id', medicineId)
        .eq('clinic_id', profile.clinicId)
        .single();

      if (medicineError || !medicine) {
        throw new Error('Medicine not found or error fetching medicine data');
      }

      const newStockLevel = medicine.current_stock + quantityChange;

      if (newStockLevel < 0) {
        throw new Error(`Invalid adjustment. Would result in negative stock. Current: ${medicine.current_stock}, Change: ${quantityChange}`);
      }

      // Update medicine stock
      const { error: updateError } = await supabase
        .from('medicines_master')
        .update({ current_stock: newStockLevel })
        .eq('clinic_id', profile.clinicId)
        .eq('id', medicineId);

      if (updateError) {
        throw new Error(`Failed to update medicine stock: ${updateError.message}`);
      }

      // Create stock movement log entry
      const movementRemarks = `Stock adjustment: ${reason}`;
      
      const { error: logError } = await supabase
        .from('stock_movement_log')
        .insert([{
          clinic_id: profile.clinicId,
          medicine_id: medicineId,
          movement_type: 'adjustment',
          quantity_change: quantityChange,
          new_stock_level: newStockLevel,
          reference_type: 'manual_adjustment',
          moved_by: adjustedBy,
          movement_date: new Date().toISOString(),
          remarks: movementRemarks
        }]);

      if (logError) {
        throw new Error(`Failed to log stock movement: ${logError.message}`);
      }

    } catch (error) {
      console.error('Error adjusting stock:', error);
      throw error;
    }
  }
};