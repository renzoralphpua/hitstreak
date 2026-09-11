import { redirect } from "next/navigation";

/** The game lives in the path so a set slug only has to be unique within its game; bare /sets picks
 *  the default rather than inventing an all-games list nobody asked for. */
export default function SetsIndex() {
  redirect("/sets/pokemon");
}
