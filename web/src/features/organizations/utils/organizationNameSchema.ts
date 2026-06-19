import { StringNoHTML } from "@hanzo/console";
import * as z from "zod/v4";

const organizationTypeOptions = [
  "Personal",
  "Educational",
  "Company",
  "Startup",
  "Agency",
  "N/A",
] as const;

const organizationSizeOptions = [
  "1-10",
  "10-49",
  "50-99",
  "100-299",
  "More than 300",
] as const;

const organizationName = StringNoHTML.min(
  3,
  "Must have at least 3 characters",
).max(60, "Must have at most 60 characters");

export const organizationFormSchema = z.object({
  name: organizationName,
});

// Base schema for org creation, used for server-side validation too
export const organizationNameSchema = organizationFormSchema;

export const organizationOptionalNameSchema = z.object({
  name: organizationName.optional(),
});
