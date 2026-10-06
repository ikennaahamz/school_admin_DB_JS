/**
 * Course sections.
 *
 * No business rules here either -- see lib/queries/students.ts for why.
 * Note that `section_fill_ratio` is a PL/pgSQL function defined in
 * migration 0002, so this query exercises the procedural layer as well as
 * the declarative one.
 */

import { exec, query } from "@/lib/db";

import { Conditions } from "./conditions";

export type SectionRow = {
  section_id: number;
  course_code: string;
  course_name: string;
  term: string;
  academic_year: number;
  credits: number;
  instructor: string;
  room: string;
  capacity: number;
  /** Maintained by trg_sections_enrolled_count, not by the application. */
  enrolled_count: number;
  fill_pct: string;
};

export type NewSection = {
  course_code: string;
  course_name: string;
  term: string;
  academic_year: number;
  instructor_id?: number | null;
  classroom_id?: number | null;
  credits: number;
  capacity: number;
};

export async function listSections(term?: string | null, academicYear?: number | null): Promise<SectionRow[]> {
  const where = new Conditions();

  if (term) where.add("cs.term = %s::term_name", [term]);
  if (academicYear) where.add("cs.academic_year = %s", [academicYear]);

  return query<SectionRow>(
    `
        SELECT cs.section_id, cs.course_code, cs.course_name,
               cs.term, cs.academic_year, cs.credits,
               COALESCE(u.first_name || ' ' || u.last_name,
                        '(unassigned)') AS instructor,
               COALESCE(c.building || ' ' || c.room_number,
                        '(no room)')    AS room,
               cs.capacity, cs.enrolled_count,
               section_fill_ratio(cs.section_id) AS fill_pct
          FROM course_sections cs
          LEFT JOIN instructors i ON i.instructor_id = cs.instructor_id
          LEFT JOIN users u       ON u.user_id = i.user_id
          LEFT JOIN classrooms c   ON c.classroom_id = cs.classroom_id
         WHERE ${where.clause}
         ORDER BY cs.academic_year DESC, cs.term, cs.course_code
        `,
    where.params,
  );
}

export async function insertSection(section: NewSection): Promise<number> {
  // The course code is normalised on the way in: a section created as
  // "cs301" would sort apart from "CS301" and never match the report
  // queries, which join on a prefix of the department code.
  const row = (await exec(
    `
        INSERT INTO course_sections (course_code, course_name, term,
                                     academic_year, instructor_id,
                                     classroom_id, credits, capacity)
        VALUES ($1, $2, $3::term_name, $4, $5, $6, $7, $8)
        RETURNING section_id
        `,
    [
      section.course_code.trim().toUpperCase(),
      section.course_name.trim(),
      section.term,
      section.academic_year,
      section.instructor_id ?? null,
      section.classroom_id ?? null,
      section.credits,
      section.capacity,
    ],
    undefined,
    "section_id",
  )) as { section_id: number };

  return row.section_id;
}

export async function updateSection(
  sectionId: number,
  changes: { instructor_id?: number | null; classroom_id?: number | null; capacity: number },
): Promise<void> {
  await exec(
    `
        UPDATE course_sections
           SET instructor_id = $1, classroom_id = $2, capacity = $3
         WHERE section_id = $4
        `,
    [changes.instructor_id ?? null, changes.classroom_id ?? null, changes.capacity, sectionId],
  );
}

export async function deleteSection(sectionId: number): Promise<number> {
  return (await exec("DELETE FROM course_sections WHERE section_id = $1", [sectionId])) as number;
}