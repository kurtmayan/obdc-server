import { PrismaClient, Role } from '../../src/generated/prisma/client';

export async function seedUsers(prisma: PrismaClient) {
  const users = {
    email: 'admin@mayan.com.ph',
    password: '$2a$12$ElgxbQO.ddNHRcnApEAnQe70stxxNF1sGRNXjvvgOcl0.nlkHvlZq', // @Admin123
    firstName: 'Juan',
    lastName: 'Dela Cruz',
    middleName: 'Doe',
    role: Role.SUPERADMIN,
  };

  await prisma.users.upsert({
    where: {
      email: users.email,
    },
    create: users,
    update: {},
  });

  console.log('  ✔ Users seeded');
}
