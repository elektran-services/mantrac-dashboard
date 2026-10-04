import ExcelJS from 'exceljs';

export interface ExcelDeviceHit {
  filename: string;
  reportDate: string | null;
  deviceid: string;
  devicename: string;
  fields: Record<string, string>;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && value && 'text' in value) {
    return String((value as { text: unknown }).text ?? '').trim();
  }
  if (typeof value === 'object' && value && 'result' in value) {
    return cellText((value as { result: unknown }).result);
  }
  return String(value).trim();
}

function columnIndex(headers: string[], labels: readonly string[]): number {
  return headers.findIndex((header) => labels.some((label) => header.includes(label)));
}

export async function searchExcelDevices(options: {
  filePath: string;
  filename: string;
  reportDate: string | null;
  query: string;
  fields: readonly { key: string; labels: readonly string[] }[];
}): Promise<ExcelDeviceHit[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(options.filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  let headerRow = 0;
  const headers: string[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (headerRow || rowNumber > 8) return;
    const values: string[] = [];
    for (let col = 1; col <= 20; col++) values.push(cellText(row.getCell(col).value).toLowerCase());
    const hasDevice =
      values.some((value) => value === 'device id' || value.startsWith('device id') || value === 'imei' || value.startsWith('imei')) ||
      values.some((value) => value.includes('device name'));
    if (hasDevice) {
      headerRow = rowNumber;
      headers.push(...values);
    }
  });
  if (!headerRow) return [];

  const idCol = columnIndex(headers, ['device id', 'imei']);
  const nameCol = columnIndex(headers, ['device name']);
  if (idCol < 0 && nameCol < 0) return [];
  const fieldCols = options.fields.map((field) => ({
    key: field.key,
    col: columnIndex(headers, field.labels),
  }));

  const hits: ExcelDeviceHit[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRow) return;
    const deviceid = idCol >= 0 ? cellText(row.getCell(idCol + 1).value) : '';
    const devicename = nameCol >= 0 ? cellText(row.getCell(nameCol + 1).value) : '';
    if (!deviceid && !devicename) return;
    if (!deviceid.toLowerCase().includes(options.query) && !devicename.toLowerCase().includes(options.query)) return;
    const fields: Record<string, string> = {};
    for (const field of fieldCols) {
      fields[field.key] = field.col >= 0 ? cellText(row.getCell(field.col + 1).value) : '';
    }
    hits.push({
      filename: options.filename,
      reportDate: options.reportDate,
      deviceid,
      devicename,
      fields,
    });
  });
  return hits;
}
