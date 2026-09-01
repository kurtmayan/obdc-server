import * as ExcelJS from 'exceljs';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

function trimToUndefined(value: string): string | undefined {
    const trimmedValue = value.trim();
    return trimmedValue.length > 0 ? trimmedValue : undefined;
}

export function getCellText(value: ExcelJS.CellValue): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    if (value instanceof Date) {
        return formatInTimeZone(value, 'UTC', 'yyyy-MM-dd HH:mm:ss');
    }

    if (typeof value !== 'object') {
        return trimToUndefined(String(value));
    }

    if ('result' in value) {
        return getCellText(value.result);
    }

    if ('text' in value) {
        return trimToUndefined(value.text);
    }

    if ('richText' in value) {
        return trimToUndefined(
        value.richText.map((richText) => richText.text).join(''),
        );
    }

    return undefined;
}