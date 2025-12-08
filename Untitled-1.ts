// ...existing code...
      const { data: receiptData, error: receiptError } = await supabase
        .from('pharmacy_inward_receipts')
        .insert([{
          clinic_id: clinicId,
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
        throw new Error(`Failed to create inward receipt: ${receiptError.message}`);
      }

      const itemsToInsert = receipt.items.map(item => ({
        receipt_id: receiptData.id, // Link item to the receipt
        product_id: item.productId,
        quantity: item.quantity,
        rate: item.rate,
        amount: item.amount,
        expiry_date: item.expiryDate ? item.expiryDate.toISOString() : null,
        batch_number: item.batchNumber,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));

      const { error: itemsError } = await supabase
        .from('pharmacy_inward_items')
        .insert(itemsToInsert);

      if (itemsError) {
        throw new Error(`Failed to insert inward items: ${itemsError.message}`);
      }
// ...existing code...