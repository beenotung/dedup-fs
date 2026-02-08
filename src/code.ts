let fuse = require('fuse-native')

export let Code = {
  not_exists: fuse.ENOENT,
  already_exists: fuse.EEXIST,
  not_a_directory: fuse.ENOTDIR,
}
