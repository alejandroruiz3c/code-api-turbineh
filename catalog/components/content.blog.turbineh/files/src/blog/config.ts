import { z } from "zod";
import params from "./params.json";

/**
 * Blog settings (component content.blog.turbineh), written by TurbineH from the request: posts per page of the public
 * list, the reading speed used for "N min read", and how many posts the RSS feed carries. Validated at start-up.
 */
export const BlogParams = z.object({
  postsPerPage: z.number().int().min(1).max(50),
  wordsPerMinute: z.number().int().min(100).max(400),
  feedItems: z.number().int().min(1).max(100),
});
export type BlogParams = z.infer<typeof BlogParams>;

export const blogConfig: BlogParams = BlogParams.parse(params);
