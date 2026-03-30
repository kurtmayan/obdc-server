import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreateDevicesDto } from 'src/generated/dto/devices/dto/create-devices.dto';
import { UpdateDevicesDto } from 'src/generated/dto/devices/dto/update-devices.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DeviceService {
  constructor(private prismaService: PrismaService) {}

  async create(createDeviceDto: CreateDevicesDto) {
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
      where: { id: createDeviceDto.store.connect.id },
    });
    if (!checkStoreExist) throw new NotFoundException('Store not found');
    const response = await this.prismaService.devices.create({
      data: createDeviceDto,
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

  async update(id: string, updateDeviceDto: UpdateDevicesDto) {
    const findDevice = await this.prismaService.devices.findFirst({
      where: { id },
    });
    if (!findDevice) throw new NotFoundException('Device not found');
    if (updateDeviceDto.store?.connect.id) {
      const checkStoreExist = await this.prismaService.stores.findFirst({
        where: { id: updateDeviceDto.store.connect.id },
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
