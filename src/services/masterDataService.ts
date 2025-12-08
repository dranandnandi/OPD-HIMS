import { supabase } from '../lib/supabase';
import { MedicineMaster, TestMaster, MedicineWithPrice, TestWithPrice, ClinicMedicinePrice, ClinicTestPrice } from '../types';
import { getCurrentProfile } from './profileService';
import type { DatabaseMedicineMaster, DatabaseTestMaster, DatabaseClinicMedicinePrice, DatabaseClinicTestPrice } from '../lib/supabase';

// Convert database medicine master to app medicine master type
const convertDatabaseMedicineMaster = (dbMedicine: DatabaseMedicineMaster): MedicineMaster => ({
  id: dbMedicine.id,
  name: dbMedicine.name,
  genericName: dbMedicine.generic_name,
  brandName: dbMedicine.brand_name,
  category: dbMedicine.category,
  dosageForm: dbMedicine.dosage_form,
  strength: dbMedicine.strength,
  manufacturer: dbMedicine.manufacturer,
  description: dbMedicine.description,
  sideEffects: dbMedicine.side_effects,
  contraindications: dbMedicine.contraindications,
  currentStock: dbMedicine.current_stock,
  reorderLevel: dbMedicine.reorder_level,
  batchNumber: dbMedicine.batch_number,
  expiryDate: dbMedicine.expiry_date ? new Date(dbMedicine.expiry_date) : undefined,
  isActive: dbMedicine.is_active,
  createdAt: new Date(dbMedicine.created_at),
  updatedAt: new Date(dbMedicine.updated_at)
});

// Convert database test master to app test master type
const convertDatabaseTestMaster = (dbTest: DatabaseTestMaster): TestMaster => ({
  id: dbTest.id,
  name: dbTest.name,
  category: dbTest.category,
  type: dbTest.type,
  normalRange: dbTest.normal_range,
  units: dbTest.units,
  description: dbTest.description,
  preparationInstructions: dbTest.preparation_instructions,
  isActive: dbTest.is_active,
  createdAt: new Date(dbTest.created_at),
  updatedAt: new Date(dbTest.updated_at)
});

// Convert app medicine master to database medicine master type
const convertMedicineToDatabase = (medicine: Omit<MedicineMaster, 'id' | 'createdAt' | 'updatedAt'>): Omit<DatabaseMedicineMaster, 'id' | 'created_at' | 'updated_at'> => ({
  name: medicine.name,
  generic_name: medicine.genericName,
  brand_name: medicine.brandName,
  category: medicine.category,
  dosage_form: medicine.dosageForm,
  strength: medicine.strength,
  manufacturer: medicine.manufacturer,
  description: medicine.description,
  side_effects: medicine.sideEffects,
  contraindications: medicine.contraindications,
  current_stock: medicine.currentStock,
  reorder_level: medicine.reorderLevel,
  batch_number: medicine.batchNumber,
  expiry_date: medicine.expiryDate?.toISOString(),
  is_active: medicine.isActive
});

// Convert app test master to database test master type
const convertTestToDatabase = (test: Omit<TestMaster, 'id' | 'createdAt' | 'updatedAt'>): Omit<DatabaseTestMaster, 'id' | 'created_at' | 'updated_at'> => ({
  name: test.name,
  category: test.category,
  type: test.type,
  normal_range: test.normalRange,
  units: test.units,
  description: test.description,
  preparation_instructions: test.preparationInstructions,
  is_active: test.isActive
});

export const masterDataService = {
  // Medicine Master Methods
  async getMedicines(clinicId?: string): Promise<MedicineWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
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
      .order('name');

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch medicines');
    }

    return data.map(medicine => {
      const baseMedicine = convertDatabaseMedicineMaster(medicine);
      const priceData = medicine.clinic_medicine_prices?.[0];
      
      return {
        ...baseMedicine,
        sellingPrice: priceData?.selling_price,
        costPrice: priceData?.cost_price
      };
    });
  },

  async searchMedicines(query: string): Promise<MedicineMaster[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('medicines_master')
      .select('*')
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId)
      .or(`name.ilike.%${query}%,generic_name.ilike.%${query}%,brand_name.ilike.%${query}%`)
      .order('name')
      .limit(20);

    if (error) {
      throw new Error('Failed to search medicines');
    }

    return data.map(convertDatabaseMedicineMaster);
  },

  async getMedicinesByCategory(category: string): Promise<MedicineMaster[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('medicines_master')
      .select('*')
      .eq('is_active', true)
      .eq('clinic_id', profile.clinicId)
      .eq('category', category)
      .order('name');

    if (error) {
      throw new Error('Failed to fetch medicines by category');
    }

    return data.map(convertDatabaseMedicineMaster);
  },

  async getMedicine(id: string, clinicId?: string): Promise<MedicineWithPrice | null> {
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
      .eq('id', id)
      .eq('clinic_id', profile.clinicId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error('Failed to fetch medicine');
    }

    const baseMedicine = convertDatabaseMedicineMaster(data);
    const priceData = data.clinic_medicine_prices?.[0];
    
    return {
      ...baseMedicine,
      sellingPrice: priceData?.selling_price,
      costPrice: priceData?.cost_price
    };
  },

  async addMedicine(medicine: Omit<MedicineMaster, 'id' | 'createdAt' | 'updatedAt'>): Promise<MedicineMaster> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbMedicine = {
      ...convertMedicineToDatabase(medicine),
      clinic_id: profile.clinicId
    };
    
    const { data, error } = await supabase
      .from('medicines_master')
      .insert([dbMedicine])
      .select()
      .single();

    if (error) {
      throw new Error('Failed to add medicine');
    }

    return convertDatabaseMedicineMaster(data);
  },

  async updateMedicine(id: string, medicine: Partial<Omit<MedicineMaster, 'id' | 'createdAt' | 'updatedAt'>>): Promise<MedicineMaster> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbMedicine: any = {};
    
    if (medicine.name) dbMedicine.name = medicine.name;
    if (medicine.genericName !== undefined) dbMedicine.generic_name = medicine.genericName;
    if (medicine.brandName !== undefined) dbMedicine.brand_name = medicine.brandName;
    if (medicine.category) dbMedicine.category = medicine.category;
    if (medicine.dosageForm) dbMedicine.dosage_form = medicine.dosageForm;
    if (medicine.strength !== undefined) dbMedicine.strength = medicine.strength;
    if (medicine.manufacturer !== undefined) dbMedicine.manufacturer = medicine.manufacturer;
    if (medicine.description !== undefined) dbMedicine.description = medicine.description;
    if (medicine.sideEffects !== undefined) dbMedicine.side_effects = medicine.sideEffects;
    if (medicine.contraindications !== undefined) dbMedicine.contraindications = medicine.contraindications;
    if (medicine.isActive !== undefined) dbMedicine.is_active = medicine.isActive;
    if (medicine.currentStock !== undefined) dbMedicine.current_stock = medicine.currentStock;
    if (medicine.reorderLevel !== undefined) dbMedicine.reorder_level = medicine.reorderLevel;
    if (medicine.batchNumber !== undefined) dbMedicine.batch_number = medicine.batchNumber;
    if (medicine.expiryDate !== undefined) dbMedicine.expiry_date = medicine.expiryDate?.toISOString();

    const { data, error } = await supabase
      .from('medicines_master')
      .update(dbMedicine)
      .eq('clinic_id', profile.clinicId)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error('Failed to update medicine');
    }

    return convertDatabaseMedicineMaster(data);
  },

  // Test Master Methods
  async getTests(clinicId?: string, options?: { type?: 'lab' | 'radiology' | 'procedure' | 'other' }): Promise<TestWithPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('tests_master')
      .select(`
        *,
        clinic_test_prices!left (
          price,
          cost
        )
      `)
      .eq('is_active', true)
      .order('name');

    if (options?.type) {
      query = query.eq('type', options.type);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error('Failed to fetch tests');
    }

    return data.map(test => {
      const baseTest = convertDatabaseTestMaster(test);
      const priceData = test.clinic_test_prices?.[0];
      
      return {
        ...baseTest,
        price: priceData?.price,
        cost: priceData?.cost
      };
    });
  },

  async searchTests(query: string): Promise<TestMaster[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('tests_master')
      .select('*')
      .eq('is_active', true)
      .ilike('name', `%${query}%`)
      .order('name')
      .limit(20);

    if (error) {
      throw new Error('Failed to search tests');
    }

    return data.map(convertDatabaseTestMaster);
  },

  async getTestsByType(type: 'lab' | 'radiology' | 'procedure' | 'other'): Promise<TestMaster[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('tests_master')
      .select('*')
      .eq('is_active', true)
      .eq('type', type)
      .order('name');

    if (error) {
      throw new Error('Failed to fetch tests by type');
    }

    return data.map(convertDatabaseTestMaster);
  },

  async getTestsByCategory(category: string): Promise<TestMaster[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('tests_master')
      .select('*')
      .eq('is_active', true)
      .eq('category', category)
      .order('name');

    if (error) {
      throw new Error('Failed to fetch tests by category');
    }

    return data.map(convertDatabaseTestMaster);
  },

  async getTest(id: string, clinicId?: string): Promise<TestWithPrice | null> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    let query = supabase
      .from('tests_master')
      .select(`
        *,
        clinic_test_prices!left (
          price,
          cost
        )
      `)
      .eq('id', id)
      .single();


    const { data, error } = await query.single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw new Error('Failed to fetch test');
    }

    const baseTest = convertDatabaseTestMaster(data);
    const priceData = data.clinic_test_prices?.[0];
    
    return {
      ...baseTest,
      price: priceData?.price,
      cost: priceData?.cost
    };
  },

  async addTest(test: Omit<TestMaster, 'id' | 'createdAt' | 'updatedAt'>): Promise<TestMaster> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbTest = convertTestToDatabase(test);
    
    const { data, error } = await supabase
      .from('tests_master')
      .insert([dbTest])
      .select()
      .single();

    if (error) {
      throw new Error('Failed to add test');
    }

    return convertDatabaseTestMaster(data);
  },

  async updateTest(id: string, test: Partial<Omit<TestMaster, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TestMaster> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const dbTest: any = {};
    
    if (test.name) dbTest.name = test.name;
    if (test.category) dbTest.category = test.category;
    if (test.type) dbTest.type = test.type;
    if (test.normalRange !== undefined) dbTest.normal_range = test.normalRange;
    if (test.units !== undefined) dbTest.units = test.units;
    if (test.description !== undefined) dbTest.description = test.description;
    if (test.preparationInstructions !== undefined) dbTest.preparation_instructions = test.preparationInstructions;
    if (test.isActive !== undefined) dbTest.is_active = test.isActive;

    const { data, error } = await supabase
      .from('tests_master')
      .update(dbTest)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error('Failed to update test');
    }

    return convertDatabaseTestMaster(data);
  },

  // Clinic-specific pricing methods
  async getClinicMedicinePrices(clinicId: string): Promise<ClinicMedicinePrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('clinic_medicine_prices')
      .select(`
        *,
        medicines_master (*),
        clinic_settings (*)
      `)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('Failed to fetch clinic medicine prices');
    }

    return data.map(price => ({
      id: price.id,
      clinicId: price.clinic_id,
      medicineId: price.medicine_id,
      sellingPrice: price.selling_price,
      costPrice: price.cost_price,
      createdAt: new Date(price.created_at),
      updatedAt: new Date(price.updated_at),
      medicine: price.medicines_master ? convertDatabaseMedicineMaster(price.medicines_master) : undefined
    }));
  },

  async setClinicMedicinePrice(clinicId: string, medicineId: string, sellingPrice: number, costPrice: number): Promise<ClinicMedicinePrice> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('clinic_medicine_prices')
      .upsert([{
        clinic_id: profile.clinicId,
        medicine_id: medicineId,
        selling_price: sellingPrice,
        cost_price: costPrice
      }], {
        onConflict: 'clinic_id,medicine_id'
      })
      .select(`
        *,
        medicines_master (*)
      `)
      .single();

    if (error) {
      throw new Error(error.message || 'Failed to set clinic medicine price');
    }

    return {
      id: data.id,
      clinicId: data.clinic_id,
      medicineId: data.medicine_id,
      sellingPrice: data.selling_price,
      costPrice: data.cost_price,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      medicine: data.medicines_master ? convertDatabaseMedicineMaster(data.medicines_master) : undefined
    };
  },

  async getClinicTestPrices(clinicId: string): Promise<ClinicTestPrice[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('clinic_test_prices')
      .select(`
        *,
        tests_master (*),
        clinic_settings (*)
      `)
      .eq('clinic_id', clinicId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error('Failed to fetch clinic test prices');
    }

    return data.map(price => ({
      id: price.id,
      clinicId: price.clinic_id,
      testId: price.test_id,
      price: price.price,
      cost: price.cost,
      createdAt: new Date(price.created_at),
      updatedAt: new Date(price.updated_at),
      test: price.tests_master ? convertDatabaseTestMaster(price.tests_master) : undefined
    }));
  },

  async setClinicTestPrice(clinicId: string, testId: string, price: number, cost: number): Promise<ClinicTestPrice> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const profile = await getCurrentProfile();
    if (!profile?.clinicId) {
      throw new Error('User not assigned to a clinic.');
    }

    const { data, error } = await supabase
      .from('clinic_test_prices')
      .upsert([{
        clinic_id: profile.clinicId,
        test_id: testId,
        price: price,
        cost: cost
      }], {
        onConflict: 'clinic_id,test_id'
      })
      .select(`
        *,
        tests_master (*)
      `)
      .single();

    if (error) {
      throw new Error(error.message || 'Failed to set clinic test price');
    }

    return {
      id: data.id,
      clinicId: data.clinic_id,
      testId: data.test_id,
      price: data.price,
      cost: data.cost,
      createdAt: new Date(data.created_at),
      updatedAt: new Date(data.updated_at),
      test: data.tests_master ? convertDatabaseTestMaster(data.tests_master) : undefined
    };
  },

  // Utility methods
  async getMedicineCategories(): Promise<string[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const { data, error } = await supabase
      .from('medicines_master')
      .select('category')
      .eq('is_active', true);

    if (error) {
      throw new Error('Failed to fetch medicine categories');
    }

    const categories = [...new Set(data.map(item => item.category))];
    return categories.sort();
  },

  async getTestCategories(): Promise<string[]> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    const { data, error } = await supabase
      .from('tests_master')
      .select('category')
      .eq('is_active', true);

    if (error) {
      throw new Error('Failed to fetch test categories');
    }

    const categories = [...new Set(data.map(item => item.category))];
    return categories.sort();
  },

  // AI-driven upsert methods for master data and pricing
  async upsertMasterDataAndPrice(
    itemType: 'medicine' | 'test',
    masterData: any,
    pricingData: { sellingPrice: number; costPrice: number },
    clinicId: string
  ): Promise<{ success: boolean; itemId: string; isNew: boolean }> {
    if (!supabase) {
      throw new Error('Supabase client not initialized');
    }

    try {
      let itemId: string;
      let isNew = false;

      if (itemType === 'medicine') {
        // Check if medicine exists
        const existingMedicines = await this.searchMedicines(masterData.name);
        
        if (existingMedicines.length > 0) {
          // Use existing medicine (no updates to master data allowed)
          const existingMedicine = existingMedicines[0];
          itemId = existingMedicine.id;
        } else {
          // Create new medicine in master catalog
          const newMedicine = await this.addMedicine({
            name: masterData.name,
            genericName: masterData.genericName || null,
            brandName: masterData.brandName || null,
            category: masterData.category || 'other',
            dosageForm: masterData.dosageForm || 'other',
            strength: masterData.strength || null,
            manufacturer: masterData.manufacturer || null,
            description: masterData.description || null,
            sideEffects: masterData.sideEffects || null,
            contraindications: masterData.contraindications || null,
            currentStock: 0,
            reorderLevel: 0,
            batchNumber: masterData.batchNumber || null,
            expiryDate: masterData.expiryDate || undefined,
            isActive: true
          });
          itemId = newMedicine.id;
          isNew = true;
        }

        // Set clinic-specific pricing
        await this.setClinicMedicinePrice(
          clinicId,
          itemId,
          pricingData.sellingPrice,
          pricingData.costPrice
        );

      } else if (itemType === 'test') {
        // Check if test exists
        const existingTests = await this.searchTests(masterData.name);
        
        if (existingTests.length > 0) {
          // Use existing test (no updates to master data allowed)
          const existingTest = existingTests[0];
          itemId = existingTest.id;
        } else {
          // Create new test in master catalog
          const newTest = await this.addTest({
            name: masterData.name,
            category: masterData.category || 'other',
            type: masterData.type || 'lab',
            normalRange: masterData.normalRange || null,
            units: masterData.units || null,
            description: masterData.description || null,
            preparationInstructions: masterData.preparationInstructions || null,
            isActive: true
          });
          itemId = newTest.id;
          isNew = true;
        }

        // Set clinic-specific pricing
        await this.setClinicTestPrice(
          clinicId,
          itemId,
          pricingData.sellingPrice,
          pricingData.costPrice
        );

      } else {
        throw new Error('Invalid item type. Must be "medicine" or "test".');
      }

      return { success: true, itemId, isNew };

    } catch (error) {
      console.error('Error in upsertMasterDataAndPrice:', error);
      throw error;
    }
  }
};