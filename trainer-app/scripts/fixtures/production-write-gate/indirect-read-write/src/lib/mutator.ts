const prisma = { user: { upsert: async () => ({ id: "owner" }) } };

export async function mutate() {
  return prisma.user.upsert();
}
