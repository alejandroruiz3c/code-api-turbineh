import { z } from "zod";

const Player = z.object({
  username: z.string().min(3),
  xp: z.number().int().nonnegative(),
});
type Player = z.infer<typeof Player>;

const ok: Player = Player.parse({ username: "billie", xp: 100 });
const bad = Player.safeParse({ username: "b", xp: -1 });
console.log(ok, bad.success ? "valid" : bad.error.issues.map((i) => i.path.join(".")));
