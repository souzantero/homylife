import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import * as request from 'supertest'
import { AppModule } from '../src/app/app.module'
import { UuidAdapter } from '../src/infra/adapters/uuid-adapter'
import { Identifier } from '../src/domain/protocols/identifier'
import { BcryptAdapter } from '../src/infra/adapters/bcrypt-adapter'
import { JwtAdapter } from '../src/infra/adapters/jwt-adapter'
import { makeLoadUserById } from '../src/app/user/factories/load-user-by-id-factory'
import { HashComparer } from '../src/domain/protocols/hash-comparer'
import { Hasher } from '../src/domain/protocols/hasher'
import { Decrypter } from '../src/domain/protocols/decrypter'
import { Encrypter } from '../src/domain/protocols/encrypter'
import { AddUser } from '../src/domain/usecases/add-user'
import { SignInWithUser } from '../src/domain/usecases/sign-in-with-user'
import { Role, User } from '../src/domain/models/user'
import { OutputtedUser } from '../src/app/user/dtos/outputted-user'

const serialize = (data: any) => JSON.parse(JSON.stringify(data))

const dropDatabase = async (prisma: PrismaClient) =>
  prisma.$transaction([prisma.user.deleteMany(), prisma.supply.deleteMany()])

const findAllSupplies = (prisma: PrismaClient) => prisma.supply.findMany()
const findAllUsers = (prisma: PrismaClient) => prisma.user.findMany()
const findOneUserById = (prisma: PrismaClient, id: string) =>
  prisma.user.findUnique({ where: { id } })

describe('App (e2e)', () => {
  const prisma: PrismaClient = new PrismaClient()

  let app: INestApplication
  let identifier: Identifier
  let hasher: Hasher
  let hashComparer: HashComparer
  let decrypter: Decrypter
  let encrypter: Encrypter

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register({ prisma })]
    }).compile()

    app = moduleFixture.createNestApplication()
    const config = app.get<ConfigService>(ConfigService)
    identifier = new UuidAdapter()
    hasher = new BcryptAdapter(+config.get<number>('BCRYPT_SALT'))
    hashComparer = new BcryptAdapter(+config.get<number>('BCRYPT_SALT'))
    decrypter = new JwtAdapter(config.get<string>('JWT_SECRET'))
    encrypter = new JwtAdapter(config.get<string>('JWT_SECRET'))

    await dropDatabase(prisma)
    await app.init()
  })

  describe('/auth', () => {
    describe('/sign-up', () => {
      it('should create a new user', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: '12345678'
          })

        expect(status).toBe(201)
        expect(body).toHaveProperty('id')
        expect(body.id).toBeDefined()
        expect(body).toHaveProperty('name', 'Felipe Antero')
        expect(body).toHaveProperty('email', 'souzantero@gmail.com')
        expect(body).not.toHaveProperty('password')
        expect(body).toHaveProperty('createdAt')
        expect(body.createdAt).toBeDefined()
        expect(body).toHaveProperty('authorizationToken')
        expect(body.authorizationToken).not.toBeNull()

        const users = await findAllUsers(prisma)
        expect(users).toHaveLength(1)
        expect(users[0]).toHaveProperty('id', body.id)
        expect(users[0]).toHaveProperty('name', body.name)
        expect(users[0]).toHaveProperty('email', body.email)
        expect(users[0]).toHaveProperty('createdAt', new Date(body.createdAt))
        expect(users[0]).toHaveProperty('updatedAt', new Date(body.updatedAt))
        expect(users[0]).toHaveProperty('deletedAt', null)
        expect(users[0]).toHaveProperty(
          'authorizationToken',
          body.authorizationToken
        )
        expect(
          await hashComparer.compare('12345678', users[0].password)
        ).toBeTruthy()

        const decrypted = await decrypter.decrypt(users[0].authorizationToken)
        expect(decrypted).toHaveProperty('sub', users[0].id)
      })

      it('should be generated a email confirmation code', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: '12345678'
          })

        expect(status).toBe(201)
        expect(body).not.toHaveProperty('emailConfirmationCode')

        const users = await findAllUsers(prisma)
        expect(users).toHaveLength(1)
        expect(users[0]).toHaveProperty('confirmedEmail', false)
        expect(users[0]).toHaveProperty('emailConfirmationCode')
        expect(users[0].emailConfirmationCode).not.toBeNull()
        expect(users[0].emailConfirmationCode).toHaveLength(6)
        expect(parseInt(users[0].emailConfirmationCode)).not.toBeNaN()
      })

      it('should fail when user already exists with the same email', async () => {
        await prisma.user.create({
          data: {
            id: identifier.identify(),
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            createdAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: '12345678'
          })

        expect(status).toBe(403)
        expect(body).toHaveProperty(
          'message',
          'the received email is already in use'
        )
      })

      it('should fail when name is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com',
            password: '12345678'
          })

        expect(status).toBe(400)
        expect(body).toHaveProperty('message', ['name should not be empty'])
      })

      it('should fail when name is empty', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: '',
            email: 'souzantero@gmail.com',
            password: '12345678'
          })

        expect(status).toBe(400)
        expect(body).toHaveProperty('message', ['name should not be empty'])
      })

      it('should fail when email is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            password: '12345678'
          })

        expect(status).toBe(400)
        expect(
          body.message.some((m) => m === 'email should not be empty')
        ).toBeTruthy()
      })

      it('should fail when email is empty', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: '',
            password: '12345678'
          })

        expect(status).toBe(400)
        expect(
          body.message.some((m) => m === 'email should not be empty')
        ).toBeTruthy()
      })

      it('should fail when email is not a valid email format', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: 'Felipe Antero',
            password: '12345678'
          })

        expect(status).toBe(400)
        expect(
          body.message.some((m) => m === 'email must be an email')
        ).toBeTruthy()
      })

      it('should fail when password is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(400)
        expect(
          body.message.some((m) => m === 'password should not be empty')
        ).toBeTruthy()
      })

      it('should fail when password is emtpy', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: ''
          })

        expect(status).toBe(400)
        expect(
          body.message.some((m) => m === 'password should not be empty')
        ).toBeTruthy()
      })

      it('should fail when password is grether than 8', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-up')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: '1234567'
          })

        expect(status).toBe(400)
        expect(
          body.message.some(
            (m) => m === 'password must be longer than or equal to 8 characters'
          )
        ).toBeTruthy()
      })
    })

    describe('/sign-in', () => {
      it('should sign user authentication token', async () => {
        const addUser = app.get<AddUser>(AddUser)
        const addedUser = await addUser.add({
          name: 'Felipe',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com',
            password: '12345678'
          })

        expect(status).toBe(200)

        const users = await findAllUsers(prisma)
        expect(users).toHaveLength(1)
        const user = users[0]
        delete user.deletedAt
        delete user.password
        delete user.emailConfirmationCode

        expect(body).toEqual(serialize(user))

        const decrypted = await decrypter.decrypt(body.authorizationToken)
        expect(decrypted).toHaveProperty('sub', addedUser.id)
      })

      it('should be unauthorized when is invalid email', async () => {
        await app.get<AddUser>(AddUser).add({
          name: 'Felipe',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .set('Content-Type', 'application/json')
          .send({
            email: 'invalid@gmail.com',
            password: '12345678'
          })

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })

      it('should be unauthorized when is invalid password', async () => {
        await app.get<AddUser>(AddUser).add({
          name: 'Felipe',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com',
            password: '98765478'
          })

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })

      it('should be unauthorized when email is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .set('Content-Type', 'application/json')
          .send({
            password: '98765478'
          })

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })

      it('should be unauthorized when password is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-in')
          .set('Content-Type', 'application/json')
          .send({
            email: 'me@mail.com'
          })

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })
    })

    describe('/sign-out', () => {
      it('should be success', async () => {
        const id = identifier.identify()
        const createdUser = await prisma.user.create({
          data: {
            id,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            authorizationToken: await encrypter.encrypt(id),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .post('/auth/sign-out')
          .set('Authorization', `Bearer ${createdUser.authorizationToken}`)

        expect(status).toBe(205)
        expect(body).toBeDefined()
        expect(body).toEqual({})

        const users = await findAllUsers(prisma)
        expect(users).toHaveLength(1)
        expect(users[0]).toHaveProperty('id', createdUser.id)
        expect(users[0]).toHaveProperty('authorizationToken', null)
        expect(users[0].updatedAt.getTime()).toBeGreaterThan(
          createdUser.updatedAt.getTime()
        )
      })
    })

    describe('/me', () => {
      it('should be unauthorized when authorization token is not sent', async () => {
        const { status, body } = await request(app.getHttpServer()).get(
          '/auth/me'
        )

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })

      it('should be unauthorized when authorization token is invalid', async () => {
        const id = identifier.identify()
        const createdUser = await prisma.user.create({
          data: {
            id,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            authorizationToken: await encrypter.encrypt(id),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .get('/auth/me')
          .set(
            'Authorization',
            `Bearer ${createdUser.authorizationToken}invalid`
          )

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })

      it('should be unauthorized when authorization token is valid but user not has authorization token saved', async () => {
        const id = identifier.identify()
        await prisma.user.create({
          data: {
            id,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        })

        const authorizationToken = await encrypter.encrypt(id)

        const { status, body } = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${authorizationToken}`)

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })

      it('should return authenticated user', async () => {
        const id = identifier.identify()
        const createdUser = await prisma.user.create({
          data: {
            id,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            authorizationToken: await encrypter.encrypt(id),
            createdAt: new Date(),
            updatedAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .get('/auth/me')
          .set('Authorization', `Bearer ${createdUser.authorizationToken}`)

        delete createdUser.deletedAt
        delete createdUser.password
        delete createdUser.emailConfirmationCode

        expect(status).toBe(200)
        expect(body).toBeDefined()
        expect(body).toEqual(serialize(createdUser))
      })
    })
  })

  describe('/users', () => {
    describe('/confirm-email', () => {
      it('should confirm user email', async () => {
        const addUser = app.get<AddUser>(AddUser)
        const { id, createdAt, updatedAt } = await addUser.add({
          name: 'Felipe',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        const addedUser = await findOneUserById(prisma, id)

        const { status, body } = await request(app.getHttpServer())
          .post(`/users/confirm-email`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com',
            confirmationCode: addedUser.emailConfirmationCode
          })

        expect(status).toBe(200)
        expect(body).toHaveProperty('id', id)
        expect(body).toHaveProperty('createdAt', createdAt.toISOString())
        expect(body).toHaveProperty('updatedAt')
        expect(new Date(body.updatedAt) > updatedAt).toBeTruthy()
        expect(body).toHaveProperty('name', 'Felipe')
        expect(body).toHaveProperty('email', 'souzantero@gmail.com')
        expect(body).toHaveProperty('role', 'USER')
        expect(body).toHaveProperty('confirmedEmail', true)
        expect(body).not.toHaveProperty('deletedAt')
        expect(body).not.toHaveProperty('emailConfirmationCode')
        expect(body).not.toHaveProperty('password')
        expect(body).not.toHaveProperty('authorizationToken')

        const users = await findAllUsers(prisma)
        expect(users).toHaveLength(1)
        expect(users[0]).toHaveProperty('emailConfirmationCode', null)
        expect(users[0]).toHaveProperty('confirmedEmail', true)
      })

      it('should be not found when user does not exists', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post(`/users/confirm-email`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'faked@gmail.com',
            confirmationCode: '101010'
          })

        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'user not found')
      })

      it('should be bad request when is invalid confirmation code', async () => {
        const addUser = app.get<AddUser>(AddUser)
        await addUser.add({
          name: 'Felipe',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        const { status, body } = await request(app.getHttpServer())
          .post(`/users/confirm-email`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com',
            confirmationCode: '101010'
          })

        expect(status).toBe(400)
        expect(body).toHaveProperty(
          'message',
          'invalid user email confirmation code'
        )
      })

      it('should be bad request when email is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post(`/users/confirm-email`)
          .set('Content-Type', 'application/json')
          .send({
            confirmationCode: '101010'
          })

        expect(status).toBe(400)
        expect(body).toHaveProperty('message')
        expect(
          body.message.some(
            (message) => (message = 'email should not be empty')
          )
        ).toBeTruthy()
      })

      it('should be bad request when confirmation code is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post(`/users/confirm-email`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(400)
        expect(body).toHaveProperty('message')
        expect(
          body.message.some(
            (message) => (message = 'confirmationCode should not be empty')
          )
        ).toBeTruthy()
      })
    })

    describe('/email-confirmation-code', () => {
      it('should refresh user email confirmation code', async () => {
        const addUser = app.get<AddUser>(AddUser)
        const { id } = await addUser.add({
          name: 'Felipe',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        const addedUser = await findOneUserById(prisma, id)

        const { status, body } = await request(app.getHttpServer())
          .post(`/users/email-confirmation-code`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(204)
        expect(body).toEqual({})

        const refreshedUser = await findOneUserById(prisma, id)

        expect(refreshedUser.id).toEqual(addedUser.id)
        expect(refreshedUser.emailConfirmationCode).not.toEqual(
          addedUser.emailConfirmationCode
        )
        expect(refreshedUser.updatedAt).not.toBeNull()
      })

      it('should be not found when user does not exist', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post(`/users/email-confirmation-code`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'user not found')
      })

      it('should be bad request when user email has already been confirmed', async () => {
        const id = identifier.identify()
        await prisma.user.create({
          data: {
            id,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            confirmedEmail: true,
            createdAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .post(`/users/email-confirmation-code`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(400)
        expect(body).toHaveProperty(
          'message',
          'user email has already been confirmed'
        )
      })

      it.skip('should be bad request when user email is not sent', () => {
        console.log('should be bad request when user email is not sent')
      })
    })

    describe('/forget-password', () => {
      it('should create an user password reset code', async () => {
        const id = identifier.identify()
        await prisma.user.create({
          data: {
            id,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            confirmedEmail: true,
            createdAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .post(`/users/forget-password`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(204)
        expect(body).toEqual({})

        const user = await findOneUserById(prisma, id)
        expect(user).not.toBeNull()
        expect(user.authorizationToken).not.toBeNull()
        expect(user.updatedAt).not.toBeNull()

        const decrypted = await decrypter.decrypt(user.authorizationToken)
        expect(decrypted).toHaveProperty('sub', user.id)
        expect(decrypted.iat).not.toBeNull()
        expect(typeof decrypted.iat === 'number').toBeTruthy()
        expect(new Date(decrypted.iat).getTime()).toBeLessThan(
          new Date().getTime()
        )
      })

      it('should be bad request when user email has not been confirmed', async () => {
        const id = identifier.identify()
        await prisma.user.create({
          data: {
            id,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            confirmedEmail: false,
            createdAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .post(`/users/forget-password`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(400)
        expect(body).toHaveProperty(
          'message',
          "the user's email has not yet been confirmed"
        )
      })

      it('should be not found when user does not exist', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post(`/users/forget-password`)
          .set('Content-Type', 'application/json')
          .send({
            email: 'souzantero@gmail.com'
          })

        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'user not found')
      })

      it.skip('should be bad request when user email is not sent', () => {
        console.log('should be bad request when user email is not sent')
      })
    })

    describe('/reset-password', () => {
      it('should reset the user password', async () => {
        const id = identifier.identify()
        const authorizationToken = await encrypter.encrypt(id)
        await prisma.user.create({
          data: {
            id,
            authorizationToken,
            name: 'Felipe Antero',
            email: 'souzantero@gmail.com',
            password: await hasher.hash('12345678'),
            confirmedEmail: true,
            createdAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer())
          .post(`/users/reset-password`)
          .set('Content-Type', 'application/json')
          .set('Authorization', `Bearer ${authorizationToken}`)
          .send({
            password: '87654321'
          })

        expect(status).toBe(200)

        const user = await makeLoadUserById(prisma).load(id)
        const outputtedUser = new OutputtedUser(user)

        expect(body).toEqual(serialize(outputtedUser))
        expect(
          await hashComparer.compare('87654321', user.password)
        ).toBeTruthy()

        expect(user.authorizationToken).toBeNull()
      })

      it('should be unauthorized when authorization token is not sent', async () => {
        const { status, body } = await request(app.getHttpServer())
          .post(`/users/reset-password`)
          .set('Content-Type', 'application/json')
          .send({
            password: '87654321'
          })

        expect(status).toBe(401)
        expect(body).toHaveProperty('message', 'Unauthorized')
      })

      it.skip('should be bad request when user password is not sent', () => {
        console.log('should be bad request when user password is not sent')
      })
    })
  })

  describe('/supplies', () => {
    describe('(GET)', () => {
      it('should be success', () => {
        return request(app.getHttpServer()).get('/supplies').expect(200)
      })

      it('should not get deleted supplies', async () => {
        const createdSupplies = await prisma.$transaction([
          prisma.supply.create({
            data: {
              id: identifier.identify(),
              name: 'Copo',
              createdAt: new Date(),
              deletedAt: new Date()
            }
          }),
          prisma.supply.create({
            data: {
              id: identifier.identify(),
              name: 'Prato',
              createdAt: new Date()
            }
          }),
          prisma.supply.create({
            data: {
              id: identifier.identify(),
              name: 'Garfo',
              createdAt: new Date()
            }
          })
        ])

        const { status, body } = await request(app.getHttpServer()).get(
          '/supplies'
        )

        expect(status).toBe(200)
        expect(body).toHaveLength(2)
        expect(
          body.find((item) => item.id === createdSupplies[0].id)
        ).toBeUndefined()
      })
    })

    describe('(POST)', () => {
      let authorizationToken

      beforeEach(async () => {
        const addedUser = await app.get<AddUser>(AddUser).add({
          name: 'Felipe Antero',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        await prisma.user.update({
          where: { id: addedUser.id },
          data: { role: Role.Admin }
        })

        const signature = await app
          .get<SignInWithUser>(SignInWithUser)
          .sign(addedUser as User)
        authorizationToken = signature.authorizationToken
      })

      it('should be unauthorized when authorization token is not sent', () => {
        return request(app.getHttpServer())
          .post('/supplies')
          .send({
            name: 'Copo'
          })
          .expect(401)
      })

      it('should create a new supply', async () => {
        const response = await request(app.getHttpServer())
          .post('/supplies')
          .set('Authorization', `Bearer ${authorizationToken}`)
          .send({
            name: 'Copo'
          })

        expect(response.status).toBe(201)
        expect(response.body).toBeDefined()
        expect(response.body).toHaveProperty('id')
        expect(response.body).toHaveProperty('name', 'Copo')

        const supplies = await findAllSupplies(prisma)

        expect(supplies).toBeDefined()
        expect(supplies).toHaveLength(1)
        expect(supplies[0]).toHaveProperty('id', response.body.id)
        expect(supplies[0]).toHaveProperty('name', response.body.name)
      })

      it('should fail when name is empty', async () => {
        const response = await request(app.getHttpServer())
          .post('/supplies')
          .set('Authorization', `Bearer ${authorizationToken}`)
          .send({
            name: ''
          })

        expect(response.status).toBe(400)
        expect(response.body).toHaveProperty('message', [
          'name should not be empty'
        ])
      })

      it('should fail when name is a number', async () => {
        const response = await request(app.getHttpServer())
          .post('/supplies')
          .set('Authorization', `Bearer ${authorizationToken}`)
          .send({
            name: 10
          })

        expect(response.status).toBe(400)
        expect(response.body).toHaveProperty('message', [
          'name must be a string'
        ])
      })
    })

    describe('/:supplyId (GET)', () => {
      it('should get a supplies', async () => {
        const createdSupply = await prisma.supply.create({
          data: {
            id: identifier.identify(),
            name: 'Copo',
            createdAt: new Date()
          }
        })

        const { status, body } = await request(app.getHttpServer()).get(
          `/supplies/${createdSupply.id}`
        )
        expect(status).toBe(200)
        expect(body).toBeDefined()
        expect(body).toEqual(serialize(createdSupply))
      })

      it('should be not found if supply not exists', async () => {
        const { status, body } = await request(app.getHttpServer()).get(
          '/supplies/fakeId'
        )
        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'supply not found')
      })

      it('should be not found if supply is deleted', async () => {
        const supply = await prisma.supply.create({
          data: {
            id: identifier.identify(),
            name: 'Copo',
            createdAt: new Date(),
            deletedAt: new Date()
          }
        })
        const { status, body } = await request(app.getHttpServer()).get(
          `/supplies/${supply.id}`
        )
        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'supply not found')
      })
    })

    describe('/:supplyId (PUT)', () => {
      let authorizationToken

      beforeEach(async () => {
        const addedUser = await app.get<AddUser>(AddUser).add({
          name: 'Felipe Antero',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        await prisma.user.update({
          where: { id: addedUser.id },
          data: { role: Role.Admin }
        })

        const signature = await app
          .get<SignInWithUser>(SignInWithUser)
          .sign(addedUser as User)
        authorizationToken = signature.authorizationToken
      })

      it('should be unauthorized when authorization token is not sent', () => {
        return request(app.getHttpServer())
          .put('/supplies/fakeId')
          .set('Content-Type', 'application/json')
          .send({
            name: 'Copo'
          })
          .expect(401)
      })

      it('should update a exited supply', async () => {
        const createdSupply = await prisma.supply.create({
          data: {
            id: identifier.identify(),
            name: 'Copo',
            createdAt: new Date()
          }
        })
        const { status } = await request(app.getHttpServer())
          .put(`/supplies/${createdSupply.id}`)
          .set('Authorization', `Bearer ${authorizationToken}`)
          .set('Content-Type', 'application/json')
          .send({
            name: 'Garfo'
          })

        expect(status).toBe(200)

        const supplies = await findAllSupplies(prisma)
        expect(supplies).toHaveLength(1)
        expect(supplies[0]).toHaveProperty('id', createdSupply.id)
        expect(supplies[0]).toHaveProperty('name', 'Garfo')
        expect(supplies[0]).toHaveProperty('createdAt', createdSupply.createdAt)
        expect(supplies[0].updatedAt).toBeDefined()
        expect(supplies[0].updatedAt.getTime()).toBeGreaterThan(
          createdSupply.createdAt.getTime()
        )
      })

      it('should be not found if supply not exists', async () => {
        const { status, body } = await request(app.getHttpServer())
          .put('/supplies/fakeId')
          .set('Authorization', `Bearer ${authorizationToken}`)
          .set('Content-Type', 'application/json')
          .send({
            name: 'Garfo'
          })

        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'supply not found')
      })

      it('should be not found if supply is deleted', async () => {
        const supply = await prisma.supply.create({
          data: {
            id: identifier.identify(),
            name: 'Copo',
            createdAt: new Date(),
            deletedAt: new Date()
          }
        })
        const { status, body } = await request(app.getHttpServer())
          .put(`/supplies/${supply.id}`)
          .set('Authorization', `Bearer ${authorizationToken}`)
          .set('Content-Type', 'application/json')
          .send({
            name: 'Garfo'
          })

        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'supply not found')
      })
    })

    describe('/:supplyId (DELETE)', () => {
      let authorizationToken

      beforeEach(async () => {
        const addedUser = await app.get<AddUser>(AddUser).add({
          name: 'Felipe Antero',
          email: 'souzantero@gmail.com',
          password: '12345678'
        })

        await prisma.user.update({
          where: { id: addedUser.id },
          data: { role: Role.Admin }
        })

        const signature = await app
          .get<SignInWithUser>(SignInWithUser)
          .sign(addedUser as User)
        authorizationToken = signature.authorizationToken
      })

      it('should be unauthorized when authorization token is not sent', () => {
        return request(app.getHttpServer())
          .delete('/supplies/fakeId')
          .set('Content-Type', 'application/json')
          .expect(401)
      })

      it('should delete a existed supply', async () => {
        const createdSupplies = await prisma.$transaction([
          prisma.supply.create({
            data: {
              id: identifier.identify(),
              name: 'Copo',
              createdAt: new Date()
            }
          }),
          prisma.supply.create({
            data: {
              id: identifier.identify(),
              name: 'Garfo',
              createdAt: new Date()
            }
          }),
          prisma.supply.create({
            data: {
              id: identifier.identify(),
              name: 'Prato',
              createdAt: new Date()
            }
          })
        ])

        const { status, body } = await request(app.getHttpServer())
          .delete(`/supplies/${createdSupplies[0].id}`)
          .set('Authorization', `Bearer ${authorizationToken}`)

        expect(status).toBe(200)
        expect(body).toEqual({})

        const supplies = await findAllSupplies(prisma)
        const deletedSupply = supplies.find(
          (supply) => supply.id === createdSupplies[0].id
        )
        expect(deletedSupply).toBeDefined()
        expect(deletedSupply.deletedAt).not.toBeNull()
      })

      it('should be not found if supply not exists', async () => {
        const { status, body } = await request(app.getHttpServer())
          .delete('/supplies/fakeId')
          .set('Authorization', `Bearer ${authorizationToken}`)

        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'supply not found')
      })

      it('should be not found if supply is deleted', async () => {
        const supply = await prisma.supply.create({
          data: {
            id: identifier.identify(),
            name: 'Copo',
            createdAt: new Date(),
            deletedAt: new Date()
          }
        })
        const { status, body } = await request(app.getHttpServer())
          .delete(`/supplies/${supply.id}`)
          .set('Authorization', `Bearer ${authorizationToken}`)

        expect(status).toBe(404)
        expect(body).toHaveProperty('message', 'supply not found')
      })
    })
  })
})
