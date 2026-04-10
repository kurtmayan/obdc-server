import { Controller, Get } from '@nestjs/common';
import { StatisticsService } from './statistics.service';

@Controller('statistics')
export class StatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Get()
  async getStatistics() {
    return {
      totalStores: await this.statisticsService.getTotalStores(),
      totalStoreSynced: await this.statisticsService.getTotalStoreSynced(),
      totalStoreUnsynced: await this.statisticsService.getTotalStoreUnsynced(),
    };
  }

  @Get('datasets')
  getDatasets() {
    return this.statisticsService.getStoreSyncChartDataLast5Days();
  }
}
