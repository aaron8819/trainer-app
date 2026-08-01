const prisma = { user: { upsert: async () => ({ id: "owner" }) } };

void prisma.user.upsert();
