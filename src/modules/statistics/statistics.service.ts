import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StatisticsService {
  constructor(private prismaService: PrismaService) {}

  async getTotalStores() {
    return this.prismaService.stores.count();
  }

  async getTotalStoreSynced() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const syncedStores = await this.prismaService.storeSyncRecord.groupBy({
      by: ['storesId'],
      where: {
        syncDate: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });

    // The total unique stores synced today
    return syncedStores.length;
  }

  async getTotalStoreUnsynced() {
    const total =
      (await this.getTotalStores()) - (await this.getTotalStoreSynced());
    return total;
  }

  private getDayRange(date: Date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  async getStoreSyncChartDataLast5Days() {
    const today = new Date();
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(today.getDate() - 4); // include today

    // Fetch all sync records in last 5 days
    const records = await this.prismaService.storeSyncRecord.findMany({
      where: {
        syncDate: { gte: this.getDayRange(fiveDaysAgo).start },
      },
      select: {
        storesId: true,
        syncDate: true,
      },
    });

    // Get total stores once
    const totalStores = await this.prismaService.stores.count();

    // Initialize data map
    const chartDataMap: Record<
      string,
      { date: string; synced: number; pending: number }
    > = {};

    for (let i = 0; i < 5; i++) {
      const day = new Date();
      day.setDate(today.getDate() - i);
      const dateStr = day.toISOString().split('T')[0]; // YYYY-MM-DD

      chartDataMap[dateStr] = {
        date: dateStr,
        synced: 0,
        pending: totalStores, // start with total stores
      };
    }

    // Aggregate synced stores per day (unique stores only)
    const dailyStoreSet: Record<string, Set<string>> = {};

    for (const rec of records) {
      const dateStr = rec.syncDate.toISOString().split('T')[0];
      if (!dailyStoreSet[dateStr]) dailyStoreSet[dateStr] = new Set();
      dailyStoreSet[dateStr].add(rec.storesId);
    }

    // Fill chart data
    for (const [date, storeSet] of Object.entries(dailyStoreSet)) {
      chartDataMap[date].synced = storeSet.size;
      chartDataMap[date].pending = totalStores - storeSet.size;
    }

    // Return sorted array (oldest first)
    return Object.values(chartDataMap).sort((a, b) =>
      a.date > b.date ? 1 : -1,
    );
  }
}
