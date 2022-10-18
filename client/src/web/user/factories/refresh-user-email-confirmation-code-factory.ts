import { RefreshUserEmailConfirmationCode } from '../../../domain'
import { UserFetchRepository } from '../../../infra'
import env from '../../../app/config/env'

export const makeRefreshUserEmailConfirmationCode = () => {
  const userRepository = new UserFetchRepository(env.serverHostAddress)
  return new RefreshUserEmailConfirmationCode(userRepository)
}