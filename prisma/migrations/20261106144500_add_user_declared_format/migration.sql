-- CreateEnum
CREATE TYPE "UserDeclaredFormat" AS ENUM ('AUTO_DETECT', 'DIGITAL_PDF', 'SCANNED_PRINTED_PDF', 'SCANNED_HANDWRITTEN_PDF', 'DOCX', 'XLSX', 'IMAGE');

-- AlterTable
ALTER TABLE "ImportJob" ADD COLUMN "userDeclaredFormat" "UserDeclaredFormat" DEFAULT 'AUTO_DETECT';
