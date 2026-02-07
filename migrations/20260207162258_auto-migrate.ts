import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table `dir` add column `parent_id` integer null references `parent`(`id`)')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`dir`, table => table.dropColumn(`parent_id`))
}
