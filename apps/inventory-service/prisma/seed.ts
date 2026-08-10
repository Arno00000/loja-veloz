// Gancho do `prisma db seed` em desenvolvimento (executado via tsx).
// A implementacao real vive em src/seed.ts, que tambem e compilada para
// dist/seed.js e usada dentro do conteiner com `node dist/seed.js`.
import '../src/seed';
