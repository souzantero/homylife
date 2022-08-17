import { PrismaClient } from "@prisma/client"
import { AddUser } from "../../domain/usecases/add-user"
import { BcryptAdapter } from "../adapters/bcrypt-adapter"
import { UuidAdapter } from "../adapters/uuid-adapter"
import { UserPrismaRepository } from "../repositories/prisma/user-prisma-repository"

export const makeAddUser = (prisma: PrismaClient, bcryptSalt: number) => {
  const identifier = new UuidAdapter()
  const hasher = new BcryptAdapter(bcryptSalt)
  const userRepository = new UserPrismaRepository(prisma)

  return new AddUser(
    identifier,
    hasher,
    userRepository,
    userRepository
  )
}