import { createContext, useContext } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Role } from './domain'
import {
  Authorization,
  ConfirmUserEmail,
  SidebarWithHeader,
  Signed,
  SignUp,
  UnauthorizedUser,
  UnsignedUser,
  ForgetUserPassword,
  ResetUserPassword
} from './web'
import {
  AddProductPage,
  EditProductPage,
  ProductPage,
  ProductsPage,
  SignInPage
} from './app/pages'

export type AppManager = {}
const app: AppManager = {}
export const AppContext = createContext(app)
export const useApp = () => {
  return useContext(AppContext)
}

function App() {
  return (
    <ChakraProvider>
      <QueryClientProvider client={new QueryClient()}>
        <AppContext.Provider value={app}>
          <BrowserRouter>
            <Routes>
              <Route path="auth">
                <Route path="sign-in" element={<SignInPage />} />
                <Route path="sign-up" element={<SignUp />} />
              </Route>
              <Route path="users">
                <Route path="confirm-email" element={<ConfirmUserEmail />} />
                <Route
                  path="forget-password"
                  element={<ForgetUserPassword />}
                />
                <Route path="reset-password" element={<ResetUserPassword />} />
              </Route>
              <Route path="manager" element={<SidebarWithHeader />}>
                <Route path="products">
                  <Route index element={<ProductsPage />} />
                  <Route
                    path="new"
                    element={
                      <Signed unsigned={<UnsignedUser />}>
                        <Authorization
                          roles={[Role.Admin]}
                          unauthorized={<UnauthorizedUser />}
                        >
                          <AddProductPage />
                        </Authorization>
                      </Signed>
                    }
                  />
                  <Route path=":productId">
                    <Route index element={<ProductPage />} />
                    <Route
                      path="edit"
                      element={
                        <Signed unsigned={<UnsignedUser />}>
                          <Authorization
                            roles={[Role.Admin]}
                            unauthorized={<UnauthorizedUser />}
                          >
                            <EditProductPage />
                          </Authorization>
                        </Signed>
                      }
                    />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </AppContext.Provider>
      </QueryClientProvider>
    </ChakraProvider>
  )
}

export default App
