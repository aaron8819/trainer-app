const prisma = { user: { upsert: async () => ({ id: "owner" }) } };

export async function GET() {
  return prisma.user.upsert();
}
