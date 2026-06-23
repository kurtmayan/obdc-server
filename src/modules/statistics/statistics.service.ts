import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatisticsService {
  constructor(private prismaService: PrismaService) {}

  async getTotalStores() {
    return this.prismaService.stores.count();
  }

  async getTotalStoreSynced(dateRange: { start: Date; end: Date }) {
    const syncedStores = await this.prismaService.storeSyncRecord.findMany({
      where: {
        status: 'SUCCESS',
        syncDate: {
          gte: dateRange.start,
          lte: dateRange.end,
        },
      },
      select: {
        storesId: true,
      },
      distinct: ['storesId'],
    });

    return syncedStores.length;
  }

  async getTotalStoreUnsynced(dateRange: { start: Date; end: Date }) {
    const total =
      (await this.getTotalStores()) -
      (await this.getTotalStoreSynced(dateRange));
    return total;
  }

  async getStoreSyncChartData(startDate?: string, endDate?: string) {
    const { start: resolvedStart, end: resolvedEnd } = this.parseDateRange(
      startDate,
      endDate,
      365, // Default to 1 year if no dates provided
    );

    const syncStats = await this.prismaService.syncStatistics.findMany({
      where: {
        syncDate: {
          gte: resolvedStart,
          lte: resolvedEnd,
        },
      },
      orderBy: {
        syncDate: 'asc',
      },
    });

    return syncStats;
  }

  parseDateRange(
    startDate?: string,
    endDate?: string,
    defaultDaysBack: number = 0,
  ): { start: Date; end: Date } {
    // resolvedEnd is always based on a fresh Date()
    const resolvedEnd = endDate ? this.parseLocalDate(endDate) : new Date();

    // resolvedStart is based on a separate fresh Date()
    const resolvedStart = startDate
      ? this.parseLocalDate(startDate)
      : (() => {
          const d = new Date(); // fresh Date, not reusing resolvedEnd
          d.setDate(d.getDate() - defaultDaysBack);
          return d;
        })();

    resolvedStart.setHours(0, 0, 0, 0);
    resolvedEnd.setHours(23, 59, 59, 999);

    return { start: resolvedStart, end: resolvedEnd };
  }

  // string "YYYY-MM-DD" -> Date in local time
  private parseLocalDate(dateStr: string): Date {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  // Date -> string "YYYY-MM-DD" in local time
  private toLocalDateStr(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
