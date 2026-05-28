# CodeLens XML SOAP / Spring Test Project

This is a standalone test project designed to verify that the CodeLens extension parses and documents XML, SOAP, and Spring configurations correctly.

## Project Structure
- `pom.xml`: Maven configuration file (used for framework detection).
- `src/main/webapp/WEB-INF/web.xml`: Defines servlets and their URL mapping routes.
- `src/main/resources/wsdl/UserService.wsdl`: A WSDL definition representing a SOAP API.
- `src/main/resources/applicationContext.xml`: Defines Spring controller and handler beans.

## Verification
You can open this folder in a new VS Code window and run the **CodeLens: Scan Workspace** command.
The tool will automatically detect the XML format, parse these files, and map the following endpoints:
1. `GET /api/users/{wildcard}` (from UserServlet)
2. `GET /api/orders/{wildcard}` (from OrderServlet)
3. `POST /UserService/getUser` (from WSDL)
4. `POST /UserService/createUser` (from WSDL)
5. `GET /authController` (from Spring bean AuthController)
6. `GET /paymentHandler` (from Spring bean PaymentHandler)
