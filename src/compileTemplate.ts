/**
 * Compiles a javascript template file.
 * This function is only working for strings, number and boolean
 */
export const compileTemplate = (
  templateStr: string,
  obj: { [key: string]: number | string | boolean },
): string => {
  let result = templateStr
  Object.entries(obj).forEach(([key, value]) => {
    const regex = regexpFactory(key)
    let serializedValue = value
    if (typeof value === 'object') {
      throw new Error('compileTemplate only works for strings and numbers')
    }
    if (typeof value !== 'number') {
      serializedValue = JSON.stringify(value)
    }
    result = result.replace(regex, serializedValue.toString())
  })
  return result
}

/**
 * Creates template regexps
 */
const regexpFactory = (name: string) => {
  const upperName = name.toUpperCase()
  return new RegExp(
    `\\/\\*\\sPLACEHOLDER-${upperName}\\s\\*\\/.*\\/\\*\\sPLACEHOLDER-${upperName}\\s\\*\\/`,
    'g',
  )
}
