import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('block'))) {
    await knex.schema.createTable('block', table => {
      table.increments('id')
      table.text('hash').notNullable().unique()
      table.integer('count').notNullable()
      table.binary('chunk').notNullable()
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

  if (!(await knex.schema.hasTable('file'))) {
    await knex.schema.createTable('file', table => {
      table.increments('id')
      table.integer('parent_id').unsigned().nullable().references('file.id')
      table.text('name').notNullable()
      table.integer('size').notNullable()
      table.integer('birth_time').notNullable()
      table.integer('modify_time').notNullable()
      table.integer('mimetype_id').unsigned().notNullable().references('mimetype.id')
      table.text('parts').nullable()
      table.integer('child_count').notNullable()
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('file')
  await knex.schema.dropTableIfExists('mimetype')
  await knex.schema.dropTableIfExists('block')
}
