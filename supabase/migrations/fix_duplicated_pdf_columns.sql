DO $$
BEGIN
    -- 1. Migrate data from CamelCase columns to snake_case columns (for Header/Footer which are duplicated)
    -- We take the value from CamelCase if the snake_case one is empty
    UPDATE clinic_settings
    SET 
        pdf_header_url = COALESCE(pdf_header_url, "pdfHeaderUrl"),
        pdf_footer_url = COALESCE(pdf_footer_url, "pdfFooterUrl");

    -- 2. Rename Margins columns (Since snake_case versions don't exist yet, we just rename the CamelCase ones)
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfMargins') THEN
        ALTER TABLE clinic_settings RENAME COLUMN "pdfMargins" TO pdf_margins;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfPrintMargins') THEN
        ALTER TABLE clinic_settings RENAME COLUMN "pdfPrintMargins" TO pdf_print_margins;
    END IF;

    -- 3. Drop the redundant CamelCase columns
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfHeaderUrl') THEN
        ALTER TABLE clinic_settings DROP COLUMN "pdfHeaderUrl";
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'clinic_settings' AND column_name = 'pdfFooterUrl') THEN
        ALTER TABLE clinic_settings DROP COLUMN "pdfFooterUrl";
    END IF;
END $$;
