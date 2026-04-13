import { Controller, Get, Query } from '@nestjs/common';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  async getStatistics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const dateRange = this.statisticsService.parseDateRange(startDate, endDate);
    return {
      totalStores: await this.statisticsService.getTotalStores(),
      totalStoreSynced:
        await this.statisticsService.getTotalStoreSynced(dateRange),
      totalStoreUnsynced:
        await this.statisticsService.getTotalStoreUnsynced(dateRange),
    };
  }

  @Get('datasets')
  getDatasets(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.statisticsService.getStoreSyncChartData(startDate, endDate);
  }
}
