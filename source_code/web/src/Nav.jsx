
import { NavLink } from "react-router-dom";

const Nav = props => {


        return (
            <>
            
            <div id = "nav">
                <div class="navbar-container">
                    
                    <ul class="navbar">
                        <li><NavLink to = "/">Settings</NavLink></li>
                        <li><NavLink to = "/lights">Lights</NavLink></li>
                        <li><NavLink to = "/account">Account</NavLink></li>
                    </ul>
                
                </div>
                <hr></hr>
            </div>

            
            </>
        )
    }

    

export default Nav;