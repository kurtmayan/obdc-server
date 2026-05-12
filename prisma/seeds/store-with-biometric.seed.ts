import {
  PrismaClient,
  Division,
  Cluster,
  Status,
} from '../../src/generated/prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

interface StoreRow {
  Code: string;
  Name: string;
  Location: string;
  Cluster: string;
  Division: string;
  'Biometric Device Brand/Model': string;
  'Serial Number': string;
}

export async function seedStoresWithBiometric(prisma: PrismaClient) {
  try {
    // Get the Excel file path - adjust based on where you place the file
    const excelFilePath = path.join(__dirname, '../data/stores.xlsx');

    // Check if file exists
    if (!fs.existsSync(excelFilePath)) {
      console.warn(`⚠️  Excel file not found at ${excelFilePath}`);
      console.log(
        'To import stores from Excel, place your file at prisma/data/stores.xlsx or update the path in the seed script.',
      );
      return;
    }

    // Read the Excel file
    const workbook = XLSX.readFile(excelFilePath);

    // Look for the specific sheet, fallback to first sheet if not found
    let sheetName = 'Roll Out Phase Per Store';
    if (!workbook.SheetNames.includes(sheetName)) {
      sheetName = workbook.SheetNames[0];
      console.log(
        `Sheet "${sheetName}" not found, using first sheet: "${sheetName}"`,
      );
    }

    const worksheet = workbook.Sheets[sheetName];

    // Convert sheet to JSON
    const rows: StoreRow[] = XLSX.utils.sheet_to_json(worksheet);

    if (rows.length === 0) {
      console.log('No data found in Excel file');
      return;
    }

    console.log(`\n📊 Found ${rows.length} stores to import`);

    // First pass: Validate all rows
    console.log('🔍 Validating data...');
    const validatedRows: Array<{
      cleanedRow: StoreRow;
      normalizedDivision: Division;
      normalizedCluster: Cluster;
    }> = [];
    let errorCount = 0;

    for (const row of rows) {
      // Clean row data - convert #N/A and "-" to null
      const cleanedRow = cleanRowData(row);

      // Validate required fields (Code is optional and can be null)
      if (
        !cleanedRow.Name ||
        !cleanedRow.Location ||
        !cleanedRow.Cluster ||
        !cleanedRow.Division
      ) {
        console.warn(
          `Skipping row with missing required fields: Code=${cleanedRow.Code}, Name=${cleanedRow.Name}`,
        );
        errorCount++;
        continue;
      }

      // Validate and normalize Division
      const normalizedDivision = normalizeDivision(cleanedRow.Division);
      if (!normalizedDivision) {
        console.warn(
          `Invalid Division "${cleanedRow.Division}" for store ${cleanedRow.Code}. Skipping row.`,
        );
        errorCount++;
        continue;
      }

      // Validate and normalize Cluster
      const normalizedCluster = normalizeCluster(cleanedRow.Cluster);
      if (!normalizedCluster) {
        console.warn(
          `Invalid Cluster "${cleanedRow.Cluster}" for store ${cleanedRow.Code}. Skipping row.`,
        );
        errorCount++;
        continue;
      }

      validatedRows.push({
        cleanedRow,
        normalizedDivision,
        normalizedCluster,
      });
    }

    if (validatedRows.length === 0) {
      console.warn('⚠️  No valid rows to import after validation');
      return;
    }

    console.log(`✅ Validated ${validatedRows.length} rows successfully\n`);

    // Second pass: Check for duplicates OUTSIDE the transaction (before import)
    console.log('🔍 Checking for duplicates...');
    let duplicateCount = 0;
    const rowsToImport: Array<{
      cleanedRow: StoreRow;
      normalizedDivision: Division;
      normalizedCluster: Cluster;
    }> = [];

    for (const row of validatedRows) {
      // Check for duplicate store (by Code and Name)
      const existingStore = await prisma.stores.findFirst({
        where: {
          AND: [{ code: row.cleanedRow.Code }, { name: row.cleanedRow.Name }],
        },
      });

      if (existingStore) {
        console.log(
          `  ⏭️  Skipping duplicate store: Code="${row.cleanedRow.Code}", Name="${row.cleanedRow.Name}"`,
        );
        duplicateCount++;
        continue;
      }

      rowsToImport.push(row);
    }

    if (rowsToImport.length === 0) {
      console.warn('⚠️  No new stores to import (all are duplicates)');
      console.log(`\n📈 === Import Summary ===`);
      console.log(`✅ Successfully imported: 0 stores`);
      if (errorCount > 0) {
        console.log(`⚠️  Validation errors: ${errorCount} rows skipped`);
      }
      console.log(`⏭️  Duplicates skipped: ${duplicateCount} rows`);
      return;
    }

    console.log(`✅ Found ${rowsToImport.length} new stores to import\n`);

    // Third pass: Insert all validated, non-duplicate data in a transaction
    console.log('💾 Importing to database...');
    let successCount = 0;

    try {
      // Wrap all database operations in a transaction
      // If any operation fails, all changes will be rolled back
      await prisma.$transaction(
        async (tx) => {
          // Process each row to import
          for (const {
            cleanedRow,
            normalizedDivision,
            normalizedCluster,
          } of rowsToImport) {
            // Create Store using transaction client
            const store = await tx.stores.create({
              data: {
                code: cleanedRow.Code,
                name: cleanedRow.Name,
                location: cleanedRow.Location,
                cluster: normalizedCluster,
                division: normalizedDivision,
                status: Status.active,
              },
            });

            // Create Device if biometric data is provided
            if (
              cleanedRow['Biometric Device Brand/Model'] &&
              cleanedRow['Serial Number']
            ) {
              // Check for duplicate device using OUTSIDE query before transaction
              // (This is acceptable since we're checking before creating the store)
              const existingDevice = await prisma.devices.findFirst({
                where: {
                  serialNumber: cleanedRow['Serial Number'],
                },
              });

              if (existingDevice) {
                console.log(
                  `  ⏭️  Skipping duplicate device: Serial Number="${cleanedRow['Serial Number']}" already exists`,
                );
                // Device already exists, but store was created. This is a partial success.
                console.log(
                  `  ✓ Store "${cleanedRow.Name}" (${cleanedRow.Code}) created (device skipped - duplicate serial)`,
                );
              } else {
                await tx.devices.create({
                  data: {
                    model: cleanedRow['Biometric Device Brand/Model'],
                    serialNumber: cleanedRow['Serial Number'],
                    storesId: store.id,
                  },
                });

                console.log(
                  `  ✓ Store "${cleanedRow.Name}" (${cleanedRow.Code}) and Device created successfully`,
                );
              }
            } else {
              console.log(
                `  ✓ Store "${cleanedRow.Name}" (${cleanedRow.Code}) created (no device data)`,
              );
            }

            successCount++;
          }
        },
        {
          timeout: 1200000, // 1200 seconds timeout (20 minutes) - only doing inserts now
        },
      );
    } catch (transactionError) {
      console.error(
        '\n❌ Transaction failed! All imported data has been rolled back.',
        transactionError instanceof Error
          ? transactionError.message
          : transactionError,
      );
      throw transactionError;
    }

    console.log(`\n📈 === Import Summary ===`);
    console.log(`✅ Successfully imported: ${successCount} stores`);
    if (errorCount > 0) {
      console.log(`⚠️  Validation errors: ${errorCount} rows skipped`);
    }
    if (duplicateCount > 0) {
      console.log(`⏭️  Duplicates skipped: ${duplicateCount} rows`);
    }
  } catch (error) {
    console.error('Fatal error during store seeding:', error);
    throw error;
  }
}

/**
 * Clean row data - convert #N/A and "-" to null
 */
function cleanRowData(row: any): StoreRow {
  const cleaned = { ...row };

  // Convert #N/A errors and "-" to null for all fields
  for (const key in cleaned) {
    const value = cleaned[key];
    if (
      value === '#N/A' ||
      value === '-' ||
      value === '#N/A Error' ||
      value === undefined
    ) {
      cleaned[key] = null;
    }
  }

  // Ensure Serial Number is always a string (Excel might read it as a number)
  if (
    cleaned['Serial Number'] &&
    typeof cleaned['Serial Number'] !== 'string'
  ) {
    cleaned['Serial Number'] = String(cleaned['Serial Number']);
  }

  return cleaned;
}

/**
 * Map division names to enum values
 */
const DIVISION_MAP: Record<string, Division> = {
  rtm_operations: 'rtm_operations',
  'rtm operations': 'rtm_operations',
  head_office: 'head_office',
  'head office': 'head_office',
  warehouse: 'warehouse',
};

/**
 * Map cluster names to enum values
 */
const CLUSTER_MAP: Record<string, Cluster> = {
  mindanao_1: 'mindanao_1',
  'mindanao 1': 'mindanao_1',
  mindanao_2: 'mindanao_2',
  'mindanao 2': 'mindanao_2',
  visayas_1: 'visayas_1',
  'visayas 1': 'visayas_1',
  visayas_2: 'visayas_2',
  'visayas 2': 'visayas_2',
  ncr_north_east: 'ncr_north_east',
  'ncr north east': 'ncr_north_east',
  'ncr north & east': 'ncr_north_east',
  ncr_south_calapa: 'ncr_south_calapa',
  'ncr south calapa': 'ncr_south_calapa',
  'ncr south & calapa': 'ncr_south_calapa',
  south_luzon: 'south_luzon',
  'south luzon': 'south_luzon',
  north_central_luzon: 'north_central_luzon',
  'north central luzon': 'north_central_luzon',
  head_office: 'head_office',
  'head office': 'head_office',
  warehouse: 'warehouse',
};

/**
 * Normalize division input to match enum values
 */
function normalizeDivision(input: string): Division | null {
  const key = input.toLowerCase().trim();
  return DIVISION_MAP[key] ?? null;
}

/**
 * Normalize cluster input to match enum values
 */
function normalizeCluster(input: string): Cluster | null {
  const key = input
    .toLowerCase()
    .trim()
    .replace(/&/g, ' ') // Replace & with space
    .replace(/\s+/g, ' '); // Normalize multiple spaces to single space
  return CLUSTER_MAP[key] ?? null;
}
