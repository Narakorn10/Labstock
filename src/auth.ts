import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { findActiveUserByEmail, validateCredentials } from "@/lib/auth-service";
import { applyActiveDepartmentUpdate } from "@/lib/department-switch";

export const { handlers, auth, unstable_update } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID || process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      name: "LabStock",
      credentials: {
        username: { label: "อีเมลหรือชื่อผู้ใช้", type: "text" },
        password: { label: "รหัสผ่าน", type: "password" },
      },
      async authorize(credentials) {
        const identifier = typeof credentials?.username === "string" ? credentials.username : "";
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        const user = await validateCredentials(identifier, password);
        if (!user) return null;

        return {
          id: user.username,
          name: user.name,
          email: user.email ?? null,
          username: user.username,
          role: user.role,
          vendor: user.vendor ?? "",
          sessionVersion: user.session_version ?? 0,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, user, profile }) {
      if (account?.provider !== "google") return true;
      const email = typeof profile?.email === "string" ? profile.email : user.email;
      return Boolean(email && await findActiveUserByEmail(email));
    },
    async jwt({ token, user, account, profile, trigger, session }) {
      // Department switch (useSession().update / unstable_update). Does nothing unless departments are enabled and the
      // requested department passes the membership check; the client-supplied `session` is never merged into the token.
      if (trigger === "update") return applyActiveDepartmentUpdate(token, session);
      if (!user) return token;

      const credentialsUser = user as typeof user & { username?: string; role?: string; vendor?: string; sessionVersion?: number };
      const googleEmail = typeof profile?.email === "string" ? profile.email : user.email;
      const databaseUser = account?.provider === "google" && googleEmail
        ? await findActiveUserByEmail(googleEmail)
        : null;
      const source = databaseUser ?? credentialsUser;

      token.username = source.username ?? user.id;
      token.role = source.role;
      token.vendor = source.vendor ?? "";
      token.sessionVersion = databaseUser?.session_version ?? credentialsUser.sessionVersion ?? 0;
      return token;
    },
    async session({ session, token }) {
      session.user = {
        ...session.user,
        username: token.username,
        role: token.role,
        vendor: token.vendor,
        sessionVersion: token.sessionVersion,
        activeDepartmentId: token.activeDepartmentId,
      } as typeof session.user;
      return session;
    },
  },
});
