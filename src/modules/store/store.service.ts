import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateStoreDto } from './dto/update-store.dto';
import { CreateStoreDto } from './dto/create-store.dto';
import { FindAllStoreDto, StoreLookup } from './dto/find-all.dto';
import { Prisma } from 'src/generated/prisma/client';

@Injectable()
export class StoreService {
  constructor(private prismaService: PrismaService) {}

  async create(createStoreDto: CreateStoreDto) {
    const checkNameExist = await this.prismaService.stores.findFirst({
      where: {
        name: createStoreDto.name,
      },
    });
    if (checkNameExist) throw new ConflictException('Store already existing');

    const response = await this.prismaService.stores.create({
      data: createStoreDto,
    });
    if (!response) throw new UnprocessableEntityException();
    return response;
  }

  async findAll({ page, pageSize, q }: FindAllStoreDto) {
    const take = pageSize;
    const skip = (page - 1) * take;

    const where = q
      ? {
          OR: [
            {
              name: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
            {
              location: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : undefined;

    const [items, count] = await this.prismaService.$transaction([
      this.prismaService.stores.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take,
        include: {
          devices: {
            select: {
              serialNumber: true,
              id: true,
              model: true,
            },
          },
        },
      }),
      this.prismaService.stores.count({ where }),
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
    const response = await this.prismaService.stores.findFirst({
      where: { id },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        devices: {
          select: {
            id: true,
            serialNumber: true,
            model: true,
          },
        },
      },
    });
    if (!response) throw new NotFoundException('Store not found');
    return response;
  }

  async update(id: string, updateStoreDto: UpdateStoreDto) {
    const findStore = await this.prismaService.stores.findFirst({
      where: { id },
    });
    if (!findStore) throw new NotFoundException('Store not found');
    const data = await this.prismaService.stores.update({
      where: { id },
      data: updateStoreDto,
    });
    if (!data) throw new UnprocessableEntityException();
    return data;
  }

  async remove(id: string) {
    const findStore = await this.prismaService.stores.findFirst({
      where: { id },
    });
    if (!findStore) throw new NotFoundException('Store not found');
    const data = await this.prismaService.stores.delete({ where: { id } });
    if (!data) throw new UnprocessableEntityException();
    return data;
  }

  async deactivateStore(id: string) {
    try {
      return await this.prismaService.stores.update({
        where: { id },
        data: { status: 'inactive' },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Store not found');
      }
      throw error;
    }
  }

  async storeLookup({ q }: StoreLookup) {
    const where = q
      ? {
          OR: [
            {
              name: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
            {
              location: {
                contains: q,
                mode: 'insensitive' as const,
              },
            },
          ],
        }
      : undefined;

    const items = await this.prismaService.stores.findMany({
      where,
      take: 5,
      select: {
        id: true,
        name: true,
        location: true,
      },
    });

    return {
      items,
    };
  }
}
