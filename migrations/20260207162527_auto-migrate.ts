import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.raw('alter table `dir` add column `ctime` integer not null')
  await knex.raw('alter table `dir` add column `mtime` integer not null')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.raw('alter table `dir` drop column `mtime`')
  await knex.raw('alter table `dir` drop column `ctime`')
}
