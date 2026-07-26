import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { FindAllDeviceDto } from './dto/find-all.dto';

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

  async findAll({ page, pageSize, q }: FindAllDeviceDto) {
    const take = pageSize;
    const skip = (page - 1) * take;

    const where = q
      ? {
          OR: [
            {
              model: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
            {
              serialNumber: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : undefined;

    const [items, count] = await this.prismaService.$transaction([
      this.prismaService.devices.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
        include: {
          store: {
            select: {
              id: true,
              name: true,
              location: true,
            },
          },
        },
      }),
      this.prismaService.devices.count({ where }),
    ]);

    return {
      items,
      page,
      pageSize: take,
      totalItems: count,
      totalPages: Math.ceil(count / take),
    };
  }

  async findOne(id: string) {
    const response = await this.prismaService.devices.findFirst({
      where: { id },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      },
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
