import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateStoresDto } from 'src/generated/dto/stores/dto/create-stores.dto';
import { UpdateStoresDto } from 'src/generated/dto/stores/dto/update-stores.dto';

@Injectable()
export class StoreService {
  constructor(private prismaService: PrismaService) {}

  async create(createStoreDto: CreateStoresDto) {
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

  async findAll() {
    return await this.prismaService.stores.findMany();
  }

  async findOne(id: string) {
    const response = await this.prismaService.stores.findFirst({
      where: { id },
    });
    if (!response) throw new NotFoundException('Store not found');
    return response;
  }

  async update(id: string, updateStoreDto: UpdateStoresDto) {
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
}
