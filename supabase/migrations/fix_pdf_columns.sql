DO $$ 
BEGIN 
    -- Rename columns if they exist in CamelCase (from previous migration version)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfHeaderUrl') THEN
        ALTER TABLE clinic_settings RENAME COLUMN "pdfHeaderUrl" TO pdf_header_url;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfFooterUrl') THEN
        ALTER TABLE clinic_settings RENAME COLUMN "pdfFooterUrl" TO pdf_footer_url;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfMargins') THEN
        ALTER TABLE clinic_settings RENAME COLUMN "pdfMargins" TO pdf_margins;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfPrintMargins') THEN
        ALTER TABLE clinic_settings RENAME COLUMN "pdfPrintMargins" TO pdf_print_margins;
    END IF;
END $$;
