import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('dir'))) {
    await knex.schema.createTable('dir', table => {
      table.increments('id')
      table.text('name').notNullable()
      table.timestamps(false, true)
    })
  }

  if (!(await knex.schema.hasTable('mimetype'))) {
    await knex.schema.createTable('mimetype', table => {
      table.increments('id')
      table.text('name').notNullable().unique()
      table.timestamps(false, true)
    })
  }
  await knex.raw('alter table `file` add column `dir_id` integer not null references `dir`(`id`)')
  await knex.raw('alter table `file` add column `size` integer not null')
  await knex.raw('alter table `file` add column `ctime` integer not null')
  await knex.raw('alter table `file` add column `mtime` integer not null')
  await knex.raw('alter table `file` add column `mimetype_id` integer not null references `mimetype`(`id`)')
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`file`, table => table.dropColumn(`mimetype_id`))
  await knex.raw('alter table `file` drop column `mtime`')
  await knex.raw('alter table `file` drop column `ctime`')
  await knex.raw('alter table `file` drop column `size`')
  await knex.schema.alterTable(`file`, table => table.dropColumn(`dir_id`))
  await knex.schema.dropTableIfExists('mimetype')
  await knex.schema.dropTableIfExists('dir')
}
