import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';

@Injectable()
export class DeviceService {
  constructor(private prismaService: PrismaService) {}

  async create(createDeviceDto: CreateDeviceDto) {
    const checkSerialNumberExist = await this.prismaService.devices.findFirst({
      where: {
        serialNumber: createDeviceDto.serialNumber,
      },
    });
    if (checkSerialNumberExist)
      throw new ConflictException(
        'Device with this serial number already exists',
      );
    const checkStoreExist = await this.prismaService.stores.findFirst({
      where: { id: createDeviceDto.storesId },
    });
    if (!checkStoreExist) throw new NotFoundException('Store not found');
    const response = await this.prismaService.devices.create({
      data: {
        model: createDeviceDto.model,
        serialNumber: createDeviceDto.serialNumber,
        storesId: createDeviceDto.storesId,
      },
    });
    if (!response) throw new UnprocessableEntityException();
    return response;
  }

  async findAll() {
    return await this.prismaService.devices.findMany();
  }

  async findOne(id: string) {
    const response = await this.prismaService.devices.findFirst({
      where: { id },
    });
    if (!response) throw new NotFoundException('Device not found');
    return response;
  }

  async update(id: string, updateDeviceDto: UpdateDeviceDto) {
    const findDevice = await this.prismaService.devices.findFirst({
      where: { id },
    });
    if (!findDevice) throw new NotFoundException('Device not found');
    if (updateDeviceDto.storesId) {
      const checkStoreExist = await this.prismaService.stores.findFirst({
        where: { id: updateDeviceDto.storesId },
      });
      if (!checkStoreExist) throw new NotFoundException('Store not found');
    }
    const data = await this.prismaService.devices.update({
      where: { id },
      data: updateDeviceDto,
    });
    if (!data) throw new UnprocessableEntityException();
    return data;
  }

  async remove(id: string) {
    const findStore = await this.prismaService.devices.findFirst({
      where: { id },
    });
    if (!findStore) throw new NotFoundException('Store not found');
    const data = await this.prismaService.devices.delete({ where: { id } });
    if (!data) throw new UnprocessableEntityException();
    return data;
  }
}
