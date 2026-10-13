import ExcelJS from 'exceljs';
import { overlapsWindow, timeWindow } from '@/lib/reportTimeWindow';

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

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function isHeaderRow(values: string[]): boolean {
  return values.some((value) => {
    const text = value.toLowerCase();
    return text === 'device id' || text.startsWith('device id') || text.startsWith('device name') || text === 'imei' || text.startsWith('imei');
  });
}

function matchesDevice(headers: string[], values: string[], query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const idCol = headers.findIndex((header) => {
    const text = header.toLowerCase();
    return text === 'device id' || text.startsWith('device id') || text === 'imei' || text.startsWith('imei');
  });
  const nameCol = headers.findIndex((header) => header.toLowerCase().includes('device name'));
  const id = idCol >= 0 ? values[idCol].toLowerCase() : '';
  const name = nameCol >= 0 ? values[nameCol].toLowerCase() : '';
  return id.includes(needle) || name.includes(needle);
}

export async function buildSavedReportCsv(
  files: { reportDate: string | null; filePath: string }[],
  query = '',
  from = '',
  to = '',
  startTime = '00:00',
  endTime = '23:59'
): Promise<string | null> {
  const window = timeWindow(from, to, startTime, endTime);
  const rows: string[][] = [];
  let headers: string[] = [];

  for (const file of files) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file.filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) continue;

    let headerRow = 0;
    const fileHeaders: string[] = [];
    worksheet.eachRow((row, rowNumber) => {
      if (headerRow || rowNumber > 8) return;
      const values: string[] = [];
      for (let col = 1; col <= 24; col++) values.push(cellText(row.getCell(col).value));
      if (!isHeaderRow(values)) return;
      headerRow = rowNumber;
      while (values.length > 0 && !values[values.length - 1]) values.pop();
      fileHeaders.push(...values);
    });
    if (!headerRow) continue;
    if (headers.length === 0) headers = ['Report date', ...fileHeaders];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRow) return;
      const values = fileHeaders.map((_, index) => cellText(row.getCell(index + 1).value));
      if (values.every((value) => !value)) return;
      if (!matchesDevice(fileHeaders, values, query)) return;
      const startCol = fileHeaders.findIndex((header) => header.toLowerCase().includes('start time'));
      const endCol = fileHeaders.findIndex((header) => header.toLowerCase().includes('end time'));
      if (!overlapsWindow(startCol >= 0 ? values[startCol] : '', endCol >= 0 ? values[endCol] : '', window)) return;
      rows.push([file.reportDate || '', ...values]);
    });
  }

  if (headers.length === 0 || rows.length === 0) return null;
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
